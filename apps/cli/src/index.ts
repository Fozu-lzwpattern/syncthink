#!/usr/bin/env node
import { runSetup } from './commands/setup.js'
import { runStatus } from './commands/status.js'
import { runSend } from './commands/send.js'
import { runCardCreate, runCardList } from './commands/card.js'
import { runTokenShow, runTokenSet, runTokenVerify, runTokenIssue } from './commands/token.js'

// ─── 参数解析 ───────────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string
  subcommand?: string
  opts: Record<string, string>
  args: string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: Record<string, string> = {}
  const positional: string[] = []

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      // boolean flags
      if (key === 'help' || key === 'force') {
        opts[key] = 'true'
        i++
      } else {
        // value flags
        const value = argv[i + 1]
        if (value !== undefined && !value.startsWith('--')) {
          opts[key] = value
          i += 2
        } else {
          opts[key] = 'true'
          i++
        }
      }
    } else if (arg === '-h') {
      opts['help'] = 'true'
      i++
    } else {
      positional.push(arg)
      i++
    }
  }

  const command = positional[0] ?? ''
  const subcommand = positional[1]
  // 剩余的位置参数（去掉 command 和 subcommand）
  const args = positional.slice(2)

  return { command, subcommand, opts, args }
}

// ─── 帮助文档 ───────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
SyncThink Agent CLI v1.0.0

用法: syncthink-agent <command> [options]

命令:
  setup                              初始化身份并注册到服务器
  status                             查看连接和令牌状态
  send --channel <id> <msg>          发送消息到 channel
  card create --channel <id>         创建卡片
       --type <type>
       --title <title>
       [--body <body>]
  card list --channel <id>           列出 channel 中的卡片
  token show                         显示当前令牌信息
  token set <token>                  保存能力令牌
  token verify                       验证令牌有效性
  token issue                        颁发令牌（需要 owner 权限）
       --aud <nodeId>
       --role <observer|collaborator|admin>
       [--expires-in-ms <ms>]

全局选项:
  --api <url>                        API 地址（默认: http://127.0.0.1:9527）
  --force                            强制重新执行（如 setup --force 重新生成密钥）
  --help, -h                         显示帮助

示例:
  syncthink-agent setup
  syncthink-agent status
  syncthink-agent send --channel abc123 "开始今天的规划"
  syncthink-agent card create --channel abc123 --type idea --title "新想法" --body "详细说明"
  syncthink-agent card list --channel abc123
  syncthink-agent token show
  syncthink-agent token set eyJhbGciOiJFZERTQSJ9...
  syncthink-agent token verify
  syncthink-agent token issue --aud <nodeId> --role collaborator

环境变量:
  SYNCTHINK_API                      覆盖默认 API 地址
`)
}

// ─── 主路由 ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, subcommand, opts, args } = parseArgs(process.argv.slice(2))

  // 全局帮助
  if (!command || opts['help'] === 'true') {
    printHelp()
    process.exit(command ? 0 : 1)
  }

  const apiUrl = opts['api']

  switch (command) {
    case 'setup': {
      await runSetup({
        apiUrl,
        force: opts['force'] === 'true',
      })
      break
    }

    case 'status': {
      await runStatus({ apiUrl })
      break
    }

    case 'send': {
      // syncthink-agent send --channel <id> [--sender <name>] <message>
      // message 是位置参数：subcommand（positional[1]）或 args[0]（positional[2]+）
      const message = subcommand ?? args[0] ?? opts['message'] ?? ''
      if (!message) {
        console.error('❌ 错误: 缺少消息内容')
        console.error('   用法: syncthink-agent send --channel <id> "<message>"')
        process.exit(1)
      }
      await runSend({
        channel: opts['channel'] ?? '',
        message,
        sender: opts['sender'],
        apiUrl,
      })
      break
    }

    case 'card': {
      if (!subcommand || opts['help'] === 'true') {
        console.log('用法:')
        console.log('  syncthink-agent card create --channel <id> --type <type> --title <title>')
        console.log('  syncthink-agent card list --channel <id>')
        break
      }
      if (subcommand === 'create') {
        await runCardCreate({
          channel: opts['channel'] ?? '',
          type: opts['type'] ?? '',
          title: opts['title'] ?? '',
          body: opts['body'],
          x: opts['x'] ? parseInt(opts['x']) : undefined,
          y: opts['y'] ? parseInt(opts['y']) : undefined,
          apiUrl,
        })
      } else if (subcommand === 'list') {
        await runCardList({
          channel: opts['channel'] ?? '',
          apiUrl,
        })
      } else {
        throw new Error(`未知子命令: card ${subcommand}，可用: create / list`)
      }
      break
    }

    case 'token': {
      if (!subcommand || opts['help'] === 'true') {
        console.log('用法:')
        console.log('  syncthink-agent token show')
        console.log('  syncthink-agent token set <token>')
        console.log('  syncthink-agent token verify')
        console.log('  syncthink-agent token issue --aud <nodeId> --role <role>')
        break
      }
      if (subcommand === 'show') {
        await runTokenShow({} as Record<string, never>)
      } else if (subcommand === 'set') {
        // token 是下一个位置参数
        const token = args[0] ?? opts['token'] ?? ''
        if (!token) {
          console.error('❌ 错误: 缺少令牌内容')
          console.error('   用法: syncthink-agent token set <token>')
          process.exit(1)
        }
        await runTokenSet(token)
      } else if (subcommand === 'verify') {
        await runTokenVerify({ apiUrl })
      } else if (subcommand === 'issue') {
        await runTokenIssue({
          aud: opts['aud'] ?? '',
          role: opts['role'] ?? '',
          expiresInMs: opts['expires-in-ms'] ? parseInt(opts['expires-in-ms']) : undefined,
          apiUrl,
        })
      } else {
        throw new Error(`未知子命令: token ${subcommand}，可用: show / set / verify / issue`)
      }
      break
    }

    default: {
      console.error(`❌ 未知命令: ${command}`)
      console.error('   运行 syncthink-agent --help 查看可用命令')
      process.exit(1)
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`❌ 错误: ${msg}`)
  process.exit(1)
})
