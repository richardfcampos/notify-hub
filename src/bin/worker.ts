/**
 * Worker entrypoint (spec NOTIF-02, NOTIF-12). Loads config, builds the
 * container, and registers the dispatch + delivery queue workers. The
 * BullMQ workers hold the event loop open (blocking Redis connections), so
 * the process stays alive without an explicit keep-alive. SIGINT/SIGTERM
 * trigger a graceful shutdown that closes the queue (draining workers).
 */
import { requiredConfigByChannel } from '../channels/channel-registry.js'
import { loadConfig } from '../config/load-config.js'
import { buildContainer } from '../container.js'

async function main(): Promise<void> {
  const config = loadConfig(process.env, requiredConfigByChannel)
  const container = buildContainer(config)
  container.registerWorkers()

  const shutdown = async (signal: string): Promise<void> => {
    try {
      console.log(`received ${signal}, shutting down worker`)
      await container.close()
      process.exit(0)
    } catch (error) {
      console.error('error during worker shutdown', error)
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  console.log('worker started; processing dispatch + delivery jobs')
}

main().catch((error) => {
  console.error('worker failed to start', error)
  process.exit(1)
})
