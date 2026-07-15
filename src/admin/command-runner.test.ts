/**
 * Exercises the real execFile-backed impl (not a fake) so the "never
 * shell-interpolate" claim is genuinely tested: args are passed as an
 * array to a real child process. Uses `process.execPath` (the Node binary
 * running the tests) instead of OS-specific shell builtins, so this stays
 * portable across the platforms the project runs on.
 */
import { describe, expect, it } from 'vitest'
import { NodeCommandRunner } from './command-runner.js'

describe('NodeCommandRunner', () => {
  it('resolves code 0 with stdout on success', async () => {
    const runner = new NodeCommandRunner()

    const result = await runner.run(process.execPath, ['-e', "console.log('hello from child')"])

    expect(result).toEqual({ code: 0, stdout: 'hello from child\n', stderr: '' })
  })

  it('resolves the actual non-zero exit code and stderr on failure', async () => {
    const runner = new NodeCommandRunner()

    const result = await runner.run(process.execPath, [
      '-e',
      "console.error('boom'); process.exit(7)"
    ])

    expect(result.code).toBe(7)
    expect(result.stderr).toContain('boom')
  })

  it('passes an argument containing shell metacharacters through untouched (no shell interpolation)', async () => {
    const runner = new NodeCommandRunner()
    const dangerous = '$(echo pwned); rm -rf /tmp/should-not-run; & | > <'

    const result = await runner.run(process.execPath, ['-e', 'console.log(process.argv[1])', dangerous])

    expect(result.stdout.trim()).toBe(dangerous)
  })
})
