// Test framework: Jest
import http from 'http'
import { LocalServer } from './LocalServer'

describe('LocalServer', () => {
  let server: LocalServer

  beforeEach(() => {
    server = new LocalServer()
  })

  afterEach(async () => {
    await server.stop()
  })

  it('starts on a free port and returns a valid localhost URL', async () => {
    await server.start()
    const url = server.getUrl()
    expect(url).toMatch(/^http:\/\/localhost:\d+$/)
  })

  it('starts on the specified port', async () => {
    const customPort = 54321
    await server.start(customPort)
    expect(server.getUrl()).toBe(`http://localhost:${customPort}`)
  })

  it('throws when started twice without stopping', async () => {
    await server.start()
    await expect(server.start()).rejects.toThrow(/already running/)
  })

  it('responds with 404 on unknown path', async () => {
    await server.start()
    const result = await new Promise<{ statusCode: number; body: string }>((resolve) => {
      const req = http.get(server.getUrl() + '/does-not-exist', (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }))
      })
      req.end()
    })
    expect(result.statusCode).toBe(404)
  })

  it('releases the port after stop is called', async () => {
    await server.start()
    const url = server.getUrl()
    await server.stop()
    const port = Number(url.split(':').pop())
    await expect(server.start(port)).resolves.not.toThrow()
    await server.stop()
  })

  it('throws when stop is called before start', async () => {
    await expect(server.stop()).rejects.toThrow(/not running/)
  })
})