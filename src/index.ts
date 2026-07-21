import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import chalk from 'chalk';

import { loadConfig } from './config.js';
import {
  MockLLMClient,
  OpenAIClient,
  type LLMClient,
} from './engine/llm-client.js';
import { Orchestrator } from './engine/orchestrator.js';
import { loadMenu } from './state/menu-loader.js';
import { getOrderSummary } from './state/order-manager.js';
import type { ConversationMessage } from './types/conversation.js';
import type { Menu } from './types/menu.js';
import type { OrderState } from './types/order.js';

export function saveConversationLog(
  history: ConversationMessage[],
  filename = `conversation-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
): string {
  const logsDirectory = path.resolve('logs');
  fs.mkdirSync(logsDirectory, { recursive: true });
  const logPath = path.join(logsDirectory, filename);
  const logContent = history
    .map((message) => {
      const role = message.role === 'assistant' ? 'STEWARD' : message.role.toUpperCase();
      return `[${role}] ${message.content}`;
    })
    .join('\n\n');
  fs.writeFileSync(logPath, `${logContent}\n`, 'utf8');
  return logPath;
}

function requestedLogFilename(args: string[]): string | undefined {
  const inlineValue = args
    .find((argument) => argument.startsWith('--log-file='))
    ?.slice('--log-file='.length);
  const separateIndex = args.indexOf('--log-file');
  const value = inlineValue ?? (separateIndex >= 0 ? args[separateIndex + 1] : undefined);

  if (!value) {
    return undefined;
  }
  if (path.basename(value) !== value || !/^[a-zA-Z0-9._-]+\.log$/.test(value)) {
    throw new Error('--log-file must be a simple .log filename.');
  }
  return value;
}

function printOrderSummary(orderState: OrderState): void {
  console.log(chalk.bold.yellow('\nFinal order'));
  console.log(chalk.white(getOrderSummary(orderState)));
}

function createClient(menu: Menu): { client: LLMClient; mode: string } {
  const config = loadConfig();
  if (config.useOpenAI && config.openAIApiKey) {
    return {
      client: new OpenAIClient({
        apiKey: config.openAIApiKey,
        model: config.openAIModel,
      }),
      mode: `OpenAI (${config.openAIModel})`,
    };
  }

  return { client: new MockLLMClient(menu), mode: 'deterministic mock' };
}

async function main(): Promise<void> {
  const logFilename = requestedLogFilename(process.argv.slice(2));
  const menu = loadMenu();
  const { client, mode } = createClient(menu);
  const orchestrator = new Orchestrator(menu, client);
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: chalk.green('You: '),
  });

  console.log(chalk.bold.yellow('\n🍽️  Welcome to Namaste Kitchen!'));
  console.log(chalk.dim('Your AI steward is ready to take your order.'));
  console.log(chalk.dim(`Reasoning mode: ${mode}`));
  console.log(
    chalk.dim('Type an order or ask about the menu. Type "quit" to exit.\n'),
  );

  try {
    if (terminal.terminal) {
      terminal.prompt();
    }
    for await (const input of terminal) {
      if (!terminal.terminal) {
        console.log(chalk.green(`You: ${input}`));
      }
      if (input.trim().toLowerCase() === 'quit') {
        break;
      }

      try {
        const response = await orchestrator.processUserInput(input);
        console.log(chalk.cyan(`\n🤖 Steward: ${response}\n`));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          chalk.red(`\nI could not process that request (${message}). Please try again.\n`),
        );
      }
      if (terminal.terminal) {
        terminal.prompt();
      }
    }
  } finally {
    terminal.close();
    printOrderSummary(orchestrator.getOrderState());
    const logPath = saveConversationLog(
      orchestrator.getConversationLog(),
      logFilename,
    );
    console.log(chalk.dim(`Conversation saved to ${logPath}\n`));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(chalk.red(message));
  process.exitCode = 1;
});
