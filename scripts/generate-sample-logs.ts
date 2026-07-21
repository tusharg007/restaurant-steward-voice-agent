import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Scenario {
  filename: string;
  turns: string[];
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(projectRoot, 'src', 'index.ts');
const scenarios: Scenario[] = [
  {
    filename: 'conversation-ordering.log',
    turns: [
      'Hi, what do you have?',
      "I'll have the Butter Chicken and a Mango Lassi.",
      'Make it two lassis.',
      "That's all, thanks.",
      'quit',
    ],
  },
  {
    filename: 'conversation-edge.log',
    turns: [
      'Can I get the Fish Amritsari?',
      "Fine, I'll take the Chicken Seekh Kebab and add a Veg Biryani.",
      'Is the tikka masala spicy?',
      'Actually, cancel the Chicken Seekh Kebab and add the Chicken Tikka Masala instead.',
      "What's my current order?",
      'quit',
    ],
  },
];

for (const scenario of scenarios) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', cliPath, '--log-file', scenario.filename],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, LLM_MODE: 'mock', OPENAI_API_KEY: '' },
      input: `${scenario.turns.join('\n')}\n`,
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `CLI scenario ${scenario.filename} failed:\n${result.stderr || result.stdout}`,
    );
  }
  process.stdout.write(result.stdout);
}

console.log('Generated sample conversation logs through the CLI.');
