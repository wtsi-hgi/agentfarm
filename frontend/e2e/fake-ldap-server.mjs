import http from 'node:http'
import net from 'node:net'

const ldapPort = Number(process.env.PLAYWRIGHT_FAKE_LDAP_PORT ?? 8390)
const healthPort = Number(process.env.PLAYWRIGHT_FAKE_LDAP_HEALTH_PORT ?? 8391)

function readLength(buffer, offset) {
  const first = buffer[offset]
  if (first === undefined) {
    return null
  }

  if ((first & 0x80) === 0) {
    return { length: first, nextOffset: offset + 1 }
  }

  const byteCount = first & 0x7f
  if (
    byteCount === 0 ||
    byteCount > 4 ||
    offset + 1 + byteCount > buffer.length
  ) {
    return null
  }

  let length = 0
  for (let index = 0; index < byteCount; index += 1) {
    length = (length << 8) + buffer[offset + 1 + index]
  }

  return { length, nextOffset: offset + 1 + byteCount }
}

function readInteger(buffer, offset) {
  if (buffer[offset] !== 0x02) {
    return null
  }

  const lengthInfo = readLength(buffer, offset + 1)
  if (!lengthInfo) {
    return null
  }

  const end = lengthInfo.nextOffset + lengthInfo.length
  if (end > buffer.length) {
    return null
  }

  let value = 0
  for (let index = lengthInfo.nextOffset; index < end; index += 1) {
    value = (value << 8) + buffer[index]
  }

  return { value, nextOffset: end }
}

function encodeLength(length) {
  if (length < 0x80) {
    return Buffer.from([length])
  }

  const bytes = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  }

  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function encodeInteger(value) {
  const bytes = []
  let remaining = value
  do {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  } while (remaining > 0)

  if ((bytes[0] & 0x80) !== 0) {
    bytes.unshift(0)
  }

  return Buffer.concat([
    Buffer.from([0x02]),
    encodeLength(bytes.length),
    Buffer.from(bytes),
  ])
}

function encodeTagged(tag, payload) {
  return Buffer.concat([
    Buffer.from([tag]),
    encodeLength(payload.length),
    payload,
  ])
}

function successBindResponse(messageId) {
  const bindPayload = Buffer.concat([
    Buffer.from([0x0a, 0x01, 0x00]),
    Buffer.from([0x04, 0x00]),
    Buffer.from([0x04, 0x00]),
  ])
  const ldapPayload = Buffer.concat([
    encodeInteger(messageId),
    encodeTagged(0x61, bindPayload),
  ])

  return encodeTagged(0x30, ldapPayload)
}

function successSearchDoneResponse(messageId) {
  const searchDonePayload = Buffer.concat([
    Buffer.from([0x0a, 0x01, 0x00]),
    Buffer.from([0x04, 0x00]),
    Buffer.from([0x04, 0x00]),
  ])
  const ldapPayload = Buffer.concat([
    encodeInteger(messageId),
    encodeTagged(0x65, searchDonePayload),
  ])

  return encodeTagged(0x30, ldapPayload)
}

function handleLdapData(socket, buffer) {
  if (buffer[0] !== 0x30) {
    return
  }

  const sequenceLength = readLength(buffer, 1)
  if (!sequenceLength) {
    return
  }

  const messageId = readInteger(buffer, sequenceLength.nextOffset)
  if (!messageId) {
    return
  }

  const protocolTag = buffer[messageId.nextOffset]
  if (protocolTag === 0x60) {
    socket.write(successBindResponse(messageId.value))
  } else if (protocolTag === 0x63) {
    socket.write(successSearchDoneResponse(messageId.value))
  } else if (protocolTag === 0x42) {
    socket.end()
  }
}

const ldapServer = net.createServer((socket) => {
  socket.on('data', (buffer) => handleLdapData(socket, buffer))
})

const healthServer = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('ok\n')
})

function listen(server, port, name) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      console.log(`${name} listening on 127.0.0.1:${port}`)
      resolve()
    })
  })
}

async function shutdown() {
  await Promise.allSettled([
    new Promise((resolve) => ldapServer.close(resolve)),
    new Promise((resolve) => healthServer.close(resolve)),
  ])
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await listen(ldapServer, ldapPort, 'Fake LDAP')
await listen(healthServer, healthPort, 'Fake LDAP health')
