import type { Ball, Effort, Mode, State, TreeItem } from '@/lib/contracts'
import { parseRow } from '@/lib/outliner-parse'

export const NEW_ITEM_TITLE = 'New item'

type PatchPayload = {
  title?: string
  mode?: Mode
  effort?: Effort
  state?: State
  ball?: Ball
  blocked_note?: string | null
  blocked_followup_date?: string | null
}

type DependencyPayload =
  | {
      from_id: string
      needs_slug: string
      to_id?: never
    }
  | {
      from_id: string
      to_id: string
      needs_slug?: never
    }

type CreateItemPayload = {
  title: string
  parent_id?: string | null
  after_id?: string | null
}

type MovePayload =
  | {
      new_parent_id?: string | null
      position: 'first'
      after_id?: never
    }
  | {
      new_parent_id?: string | null
      position?: 'after'
      after_id?: string | null
    }

export type RowKeyboardCommand = {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

export type RemovedDependency = {
  id: string
  slug: string
}

export type SubmitRowTextOptions = {
  destructiveDependencyRemoval?: 'confirmed'
}

export class DependencyRemovalConfirmationRequiredError extends Error {
  readonly dependencies: RemovedDependency[]

  constructor(dependencies: RemovedDependency[]) {
    super(
      dependencies.length === 1
        ? `Removing dependency ${dependencies[0]?.slug ?? ''} requires confirmation`
        : 'Removing dependencies requires confirmation'
    )
    this.name = 'DependencyRemovalConfirmationRequiredError'
    this.dependencies = dependencies
    Object.setPrototypeOf(
      this,
      DependencyRemovalConfirmationRequiredError.prototype
    )
  }
}

export type RowMutationActions = {
  patchItem: (itemId: string, patch: PatchPayload) => Promise<unknown>
  createDependency: (input: DependencyPayload) => Promise<unknown>
  deleteDependency: (dependencyId: string) => Promise<unknown>
  createItem: (input: CreateItemPayload) => Promise<{ id: string }>
  indentItem: (itemId: string) => Promise<unknown>
  outdentItem: (itemId: string) => Promise<unknown>
  deleteItem: (itemId: string) => Promise<unknown>
  moveItem: (itemId: string, input: MovePayload) => Promise<unknown>
}

export type RowKeyboardResult = {
  handled: boolean
  createdItemId?: string
  deletedItemId?: string
}

function removedDependencies(
  item: TreeItem,
  requestedNeeds: ReadonlySet<string>
): RemovedDependency[] {
  const existingNeeds = new Set(item.needs)
  return item.needs_edges.filter(
    (edge) =>
      edge.automatic_chain !== true &&
      existingNeeds.has(edge.slug) &&
      !requestedNeeds.has(edge.slug)
  )
}

export async function submitRowText(
  item: TreeItem,
  text: string,
  actions: Pick<
    RowMutationActions,
    'patchItem' | 'createDependency' | 'deleteDependency'
  >,
  options: SubmitRowTextOptions = {}
): Promise<void> {
  const parsed = parseRow(text)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  const patch: PatchPayload = {}
  const title = parsed.row.title.trim()
  if (title && title !== item.title) {
    patch.title = title
  }
  if (parsed.row.mode && parsed.row.mode !== item.mode) {
    patch.mode = parsed.row.mode
  }
  if (parsed.row.effort && parsed.row.effort !== item.effort) {
    patch.effort = parsed.row.effort
  }
  if (parsed.row.state && parsed.row.state !== item.state) {
    patch.state = parsed.row.state
  }
  if (parsed.row.ball && parsed.row.ball !== item.ball) {
    patch.ball = parsed.row.ball
  }

  const existingNeeds = new Set(item.needs)
  const requestedNeeds = new Set(parsed.row.needs)
  const dependenciesToRemove = removedDependencies(item, requestedNeeds)
  if (
    dependenciesToRemove.length > 0 &&
    options.destructiveDependencyRemoval !== 'confirmed'
  ) {
    throw new DependencyRemovalConfirmationRequiredError(dependenciesToRemove)
  }

  if (Object.keys(patch).length > 0) {
    await actions.patchItem(item.id, patch)
  }

  for (const needsSlug of requestedNeeds) {
    if (!existingNeeds.has(needsSlug)) {
      await actions.createDependency({
        from_id: item.id,
        needs_slug: needsSlug,
      })
    }
  }

  for (const edge of dependenciesToRemove) {
    await actions.deleteDependency(edge.id)
  }
}

export async function createNextSibling(
  item: TreeItem,
  actions: Pick<RowMutationActions, 'createItem'>
): Promise<{ id: string }> {
  return actions.createItem({
    title: NEW_ITEM_TITLE,
    parent_id: item.parent_id,
    after_id: item.id,
  })
}

export async function createChild(
  item: TreeItem,
  actions: Pick<RowMutationActions, 'createItem'>
): Promise<{ id: string }> {
  return actions.createItem({
    title: NEW_ITEM_TITLE,
    parent_id: item.id,
  })
}

export async function createFirstRoot(
  title: string,
  actions: Pick<RowMutationActions, 'createItem'>
): Promise<{ id: string }> {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    throw new Error('Title is required')
  }

  return actions.createItem({
    title: trimmedTitle,
    parent_id: null,
  })
}

export async function applyRowKeyboardCommand(
  item: TreeItem,
  text: string,
  command: RowKeyboardCommand,
  actions: RowMutationActions,
  options: SubmitRowTextOptions = {}
): Promise<RowKeyboardResult> {
  if (command.key === 'Enter') {
    await submitRowText(item, text, actions, options)
    return { handled: true }
  }

  if (command.key === 'Tab') {
    await submitRowText(item, text, actions, options)
    if (command.shiftKey) {
      await actions.outdentItem(item.id)
    } else {
      await actions.indentItem(item.id)
    }
    return { handled: true }
  }

  if (command.key === 'Delete' && (command.ctrlKey || command.metaKey)) {
    await actions.deleteItem(item.id)
    return { handled: true, deletedItemId: item.id }
  }

  return { handled: false }
}

export async function moveRowAfter(
  item: TreeItem,
  afterId: string,
  actions: Pick<RowMutationActions, 'moveItem'>
): Promise<void> {
  await actions.moveItem(item.id, {
    new_parent_id: item.parent_id,
    position: 'after',
    after_id: afterId,
  })
}

export async function moveRowToFirst(
  item: TreeItem,
  actions: Pick<RowMutationActions, 'moveItem'>
): Promise<void> {
  await actions.moveItem(item.id, {
    new_parent_id: item.parent_id,
    position: 'first',
  })
}
