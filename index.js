#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { execSync, spawn } from 'child_process';
import chalk from 'chalk';

const program = new Command();
const __dirname = path.resolve(path.dirname(new URL(import.meta.url).pathname));

// Helper Functions
function getThoughtsDir() {
    const projectRoot = process.cwd();
    const thoughtsDir = path.join(projectRoot, 'thoughts');
    fs.ensureDirSync(thoughtsDir);
    return thoughtsDir;
}

function getPrompt(name) {
    const promptPath = path.join(__dirname, 'templates', `${name}.txt`);
    return fs.readFileSync(promptPath, 'utf8');
}

function getLatestFile(directory) {
    const files = fs.readdirSync(directory);
    const filteredFiles = files.filter(file => file.endsWith('_research.md'));
    if (filteredFiles.length === 0) {
        return null;
    }
    // Sort by date (assuming ISO 8601 timestamp prefix)
    filteredFiles.sort((a, b) => {
        const dateA = new Date(a.split('_')[0]);
        const dateB = new Date(b.split('_')[0]);
        return dateB - dateA;
    });
    return path.join(directory, filteredFiles[0]);
}

function getNextPlanVersion(planDir, planName) {
    fs.ensureDirSync(planDir);
    const files = fs.readdirSync(planDir);
    const planFiles = files.filter(file => file.startsWith(planName) && file.endsWith('.md'));
    let maxVersion = 0;
    for (const file of planFiles) {
        const match = file.match(new RegExp(`${planName}-v(\\d+)\\.md`));
        if (match) {
            const version = parseInt(match[1], 10);
            if (!isNaN(version) && version > maxVersion) {
                maxVersion = version;
            }
        }
    }
    return `${planName}-v${maxVersion + 1}.md`;
}

function sanitizeForFilename(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

/**
 * Spawns the gemini CLI command with fallback to gemini-2.5-flash on token errors.
 * @param {string[]} args - Arguments to pass to the gemini command.
 * @param {object} options - Options for child_process.spawn.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>} - The output and exit code of the gemini process.
 */
async function spawnGeminiWithFallback(args, options) {
    const GEMINI_COMMAND = 'gemini';
    const FALLBACK_MODEL = 'gemini-2.5-flash';

    const runCommand = async (currentArgs) => {
        let stdout = '';
        let stderr = '';
        let code = 0;

        console.log(chalk.blue(`\nAttempting to run: ${GEMINI_COMMAND} ${currentArgs.join(' ')}`));

        const geminiProcess = spawn(GEMINI_COMMAND, currentArgs, options);

        if (options.stdio === 'inherit') {
            // If stdio is inherit, we can't capture output directly, so we just wait
            await new Promise((resolve) => {
                geminiProcess.on('close', (exitCode) => {
                    code = exitCode;
                    resolve();
                });
            });
        } else {
            geminiProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            geminiProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            await new Promise((resolve) => {
                geminiProcess.on('close', (exitCode) => {
                    code = exitCode;
                    resolve();
                });
            });
        }
        return { stdout, stderr, code };
    };

    let result = await runCommand(args);

    // Check for token-related errors if not using 'inherit' stdio
    if (result.code !== 0 && options.stdio !== 'inherit' &&
        (result.stderr.includes("RESOURCE_EXHAUSTED") ||
         result.stderr.includes("quota") ||
         result.stderr.includes("rate limit") ||
         result.stderr.includes("out of tokens"))) {

        console.warn(chalk.yellow("Detected token-related error. Retrying with gemini-2.5-flash..."));

        const flashArgs = [];
        let skipNext = false; // Flag to skip the model name after --model
        let modelFound = false; // Flag to indicate if --model was in original args

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (skipNext) {
                skipNext = false; // Reset for the next iteration
                continue; // Skip the original model name
            }

            if (arg === "--model") {
                flashArgs.push("--model", FALLBACK_MODEL);
                modelFound = true;
                skipNext = true; // Set flag to skip the next argument (original model name)
            } else {
                flashArgs.push(arg);
            }
        }

        // If --model was not in original args, add it
        if (!modelFound) {
            flashArgs.push("--model", FALLBACK_MODEL);
        }

        result = await runCommand(flashArgs);
    }

    return result;
}

// Commands
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

program
    .name('gpfw')
    .description('Gemini Phased Workflow CLI tool')
    .version(packageJson.version);

program
    .command('research')
    .description('Conducts research on a given goal using Gemini and saves the output.')
    .argument('<goal>', 'The goal for the research.')
    .action(async (goal) => {
        try {
            const thoughtsDir = getThoughtsDir();
            const researchDir = path.join(thoughtsDir, 'research');
            fs.ensureDirSync(researchDir);

            const prompt = getPrompt('research').replace('{{goal}}', goal);
            const timestamp = new Date().toISOString();
            const outputFile = path.join(researchDir, `${timestamp}_research.md`);

            console.log(chalk.blue(`\nResearching goal: "${goal}"...`));
            console.log(chalk.blue(`Saving research to: ${outputFile}`));

            const { stdout: researchOutput, stderr: researchStderr, code: researchCode } = await spawnGeminiWithFallback(
                [prompt],
                { stdio: ['inherit', 'pipe', 'pipe'] }
            );

            if (researchCode !== 0) {
                throw new Error(`Gemini process exited with code ${researchCode}`);
            }

            fs.writeFileSync(outputFile, researchOutput);
        } catch (error) {
            console.error(chalk.red(`Error during research command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program
    .command('plan')
    .description('Generates a new plan based on the latest research.')
    .argument('<description>', 'A description of the plan to be generated.')
    .option('-r, --research <files...>', 'Paths to research files to use.')
    .action(async (description, options) => {
        try {
            const thoughtsDir = getThoughtsDir();
            const planDir = path.join(thoughtsDir, 'plans');
            fs.ensureDirSync(planDir);

            let researchContent = '';
            if (options.research && options.research.length > 0) {
                console.log(chalk.blue(`\nUsing research files: ${options.research.join(', ')}`));
                for (const file of options.research) {
                    if (fs.existsSync(file)) {
                        researchContent += fs.readFileSync(file, 'utf8') + '\n\n';
                    } else {
                        console.error(chalk.red(`Error: Research file not found at ${file}`));
                        process.exit(1);
                    }
                }
            } else {
                const researchDir = path.join(thoughtsDir, 'research');
                const latestResearchFile = getLatestFile(researchDir);

                if (!latestResearchFile) {
                    console.error(chalk.red('Error: No research file found. Please run "gpfw research <goal>" or provide research files with --research.'));
                    process.exit(1);
                }
                console.log(chalk.blue(`\nGenerating new plan based on latest research from ${latestResearchFile}...`));
                researchContent = fs.readFileSync(latestResearchFile, 'utf8');
            }

            const namePlanPrompt = getPrompt('name-plan').replace('{{description}}', description);
            const { stdout: namePlanOutput, code: namePlanCode } = await spawnGeminiWithFallback(
                [namePlanPrompt],
                { stdio: ['inherit', 'pipe', 'pipe'] }
            );
            if (namePlanCode !== 0) {
                throw new Error(`Gemini process for plan naming exited with code ${namePlanCode}`);
            }
            const planName = sanitizeForFilename(namePlanOutput.trim());

            const planPrompt = getPrompt('plan').replace('{{research}}', researchContent);
            const nextPlanFileName = getNextPlanVersion(planDir, planName);
            const outputFile = path.join(planDir, nextPlanFileName);

            console.log(chalk.blue(`Saving plan to: ${outputFile}`));

            const { stdout: planOutput, stderr: planStderr, code: planCode } = await spawnGeminiWithFallback(
                [planPrompt],
                { stdio: ['inherit', 'pipe', 'pipe'] }
            );

            if (planCode !== 0) {
                throw new Error(`Gemini process for plan generation exited with code ${planCode}`);
            }

            fs.writeFileSync(outputFile, planOutput);
        } catch (error) {
            console.error(chalk.red(`Error during plan command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program
    .command('refine')
    .description('Refines an existing plan.')
    .argument('<planFile>', 'The path to the plan file to be refined.')
    .option('-i, --interactive', 'Refine the plan interactively.')
    .action(async (planFile, options) => {
        try {
            const thoughtsDir = getThoughtsDir();
            const planDir = path.join(thoughtsDir, 'plans');
            fs.ensureDirSync(planDir);

            if (!fs.existsSync(planFile) || !fs.lstatSync(planFile).isFile()) {
                console.error(chalk.red(`Error: Plan file not found at ${planFile}`));
                process.exit(1);
            }

            const planContent = fs.readFileSync(planFile, 'utf8');
            const refinePrompt = options.interactive
                ? getPrompt('refine-interactive').replace('{{plan}}', planContent)
                : getPrompt('refine').replace('{{plan}}', planContent);

            if (options.interactive) {
                console.log(chalk.blue(`\nStarting interactive refinement for plan: ${planFile}`));
                console.log(chalk.yellow('Please interact with Gemini to refine the plan. You will need to manually save the refined plan.'));
                console.log(chalk.yellow('Press Ctrl+C to exit the interactive session when done.'));

                const { code: interactiveCode } = await spawnGeminiWithFallback(
                    ['-i', refinePrompt],
                    { stdio: 'inherit' }
                );

                if (interactiveCode === 0) {
                    console.log(chalk.green(`\nInteractive refinement session closed.`));
                } else {
                    console.error(chalk.red(`Interactive refinement session exited with code ${interactiveCode}`));
                }
                process.exit(interactiveCode);
            } else {
                console.log(chalk.blue(`\nRefining plan: ${planFile}...`));
                const { stdout: planOutput, stderr: planStderr, code: planCode } = await spawnGeminiWithFallback(
                    [refinePrompt],
                    { stdio: ['inherit', 'pipe', 'pipe'] }
                );

                if (planCode !== 0) {
                    throw new Error(`Gemini process for plan refinement exited with code ${planCode}`);
                }

                const planDir = path.dirname(planFile);
                const planName = path.basename(planFile, '.md').replace(/-v\d+$/, '');
                const nextPlanFileName = getNextPlanVersion(planDir, planName);
                const outputFile = path.join(planDir, nextPlanFileName);

                fs.writeFileSync(outputFile, planOutput);
                console.log(chalk.green(`Plan refined and saved to: ${outputFile}`));
            }
        } catch (error) {
            console.error(chalk.red(`Error during refine command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program
    .command('implement')
    .description('Generates code based on a plan file and a phase request.')
    .argument('<planFile>', 'The path to the plan file (e.g., "thoughts/plans/plan-v1.md").')
    .argument('<phaseRequest>', 'A description of the specific phase or component to implement.')
    .action(async (planFile, phaseRequest) => {
        try {
            if (!fs.existsSync(planFile)) {
                console.error(chalk.red(`Error: Plan file not found at ${planFile}`));
                process.exit(1);
            }

            const planContent = fs.readFileSync(planFile, 'utf8');
            const implementPrompt = getPrompt('implement')
                .replace('{{plan}}', planContent)
                .replace('{{phaseRequest}}', phaseRequest);

            console.log(chalk.blue(`\nImplementing phase "${phaseRequest}" based on plan ${planFile}...`));

            const { code: implementCode } = await spawnGeminiWithFallback(
                [implementPrompt],
                { stdio: 'inherit' }
            );

            if (implementCode !== 0) {
                throw new Error(`Gemini process for implementation exited with code ${implementCode}`);
            }
        } catch (error) {
            console.error(chalk.red(`Error during implement command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program
    .command('validate')
    .description('Reviews code in a specified directory against a plan file and prints the validation report.')
    .argument('<planFile>', 'The path to the plan file (e.g., "thoughts/plans/plan-v1.md").')
    .argument('<codeDir>', 'The path to the directory containing the code to be validated (e.g., "src/components/").')
    .action(async (planFile, codeDir) => {
        try {
            if (!fs.existsSync(planFile)) {
                console.error(chalk.red(`Error: Plan file not found at ${planFile}`));
                process.exit(1);
            }
            if (!fs.existsSync(codeDir) || !fs.lstatSync(codeDir).isDirectory()) {
                console.error(chalk.red(`Error: Code directory not found or is not a directory at ${codeDir}`));
                process.exit(1);
            }

            const planContent = fs.readFileSync(planFile, 'utf8');
            const validatePrompt = getPrompt('validate')
                .replace('{{plan}}', planContent)
                .replace('{{codeDir}}', codeDir);

            const absoluteCodeDir = path.resolve(codeDir);

            console.log(chalk.blue(`\nValidating code in ${absoluteCodeDir} against plan ${planFile}...`));

            // The gemini CLI expects @<directory> to include directory content
            const { code: validateCode } = await spawnGeminiWithFallback(
                [validatePrompt, `@${absoluteCodeDir}`],
                { stdio: 'inherit' }
            );

            if (validateCode !== 0) {
                throw new Error(`Gemini process for validation exited with code ${validateCode}`);
            }
        } catch (error) {
            console.error(chalk.red(`Error during validate command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program.parse(process.argv);
