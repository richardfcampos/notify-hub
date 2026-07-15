/**
 * API entrypoint (spec NOTIF-12). Loads config, builds the container, and
 * starts the Fastify server. It only produces dispatch jobs (via POST
 * /notify) -- it does NOT register queue workers; the worker process does.
 * SIGINT/SIGTERM trigger a graceful shutdown: close the server, then the
 * queue.
 */
import { requiredConfigByChannel } from '../channels/channel-registry.js'
import { loadConfig } from '../config/load-config.js'
import { buildContainer } from '../container.js'
import { buildServer } from '../api/server.js'

async function main(): Promise<void> {
  const config = loadConfig(process.env, requiredConfigByChannel)
  const container = buildContainer(config)
  const server = buildServer(container.buildServerDeps())

  const shutdown = async (signal: string): Promise<void> => {
    try {
      console.log(`received ${signal}, shutting down api`)
      await server.close()
      await container.close()
      process.exit(0)
    } catch (error) {
      console.error('error during api shutdown', error)
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`api listening on port ${config.port}`)
}

main().catch((error) => {
  console.error('api failed to start', error)
  process.exit(1)
})
