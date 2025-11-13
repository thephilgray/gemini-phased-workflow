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

// Commands
program
    .name('gpfw')
    .description('Gemini Phased Workflow CLI tool')
    .version('0.1.0');

program
    .command('research <goal>')
    .description('Conducts research on a given goal using Gemini and saves the output.')
    .argument('<goal>', 'The research goal to provide to Gemini.')
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

            const geminiProcess = spawn('gemini', [prompt], { stdio: ['inherit', 'pipe', 'pipe'] });
            let researchOutput = '';
            geminiProcess.stdout.on('data', (data) => {
                researchOutput += data.toString();
            });
            geminiProcess.stderr.on('data', (data) => {
                console.error(chalk.red(data.toString()));
            });

            await new Promise((resolve, reject) => {
                geminiProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Gemini process exited with code ${code}`));
                    }
                });
            });

            fs.writeFileSync(outputFile, researchOutput);
            console.log(chalk.green(`Research complete and saved to ${outputFile}`));
        } catch (error) {
            console.error(chalk.red(`Error during research command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program
    .command('plan <arg>')
    .description('Generates a new plan based on the latest research or refines an existing plan.')
    .argument('<arg>', 'Either a string for a new plan (e.g., "Create a dark mode toggle") or a path to an existing plan file for refinement (e.g., "thoughts/plans/plan-v1.md").')
    .action(async (arg) => {
        try {
            const thoughtsDir = getThoughtsDir();
            const planDir = path.join(thoughtsDir, 'plans');
            fs.ensureDirSync(planDir);

            // Check if arg is a file path (for refinement) or a string (for new plan)
            const isFilePath = fs.existsSync(arg) && fs.lstatSync(arg).isFile();

            if (isFilePath) {
                // Refine Plan Branch
                const planContent = fs.readFileSync(arg, 'utf8');
                const refinePrompt = getPrompt('refine').replace('{{plan}}', planContent);

                console.log(chalk.blue(`\nStarting interactive refinement for plan: ${arg}`));
                console.log(chalk.yellow('Please interact with Gemini to refine the plan. You will need to manually save the refined plan.'));
                console.log(chalk.yellow('Press Ctrl+C to exit the interactive session when done.'));

                const geminiProcess = spawn('gemini', ['-i', refinePrompt], { stdio: 'inherit' });

                geminiProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(chalk.green('Interactive refinement session closed.'));
                    } else {
                        console.error(chalk.red(`Interactive refinement session exited with code ${code}`));
                    }
                    process.exit(code);
                });
            } else {
                // New Plan Branch
                const researchDir = path.join(thoughtsDir, 'research');
                const latestResearchFile = getLatestFile(researchDir);

                if (!latestResearchFile) {
                    console.error(chalk.red('Error: No research file found. Please run "gpfw research <goal>" first.'));
                    process.exit(1);
                }

                const namePlanPrompt = getPrompt('name-plan').replace('{{description}}', arg);
                const planName = sanitizeForFilename(execSync(`gemini "${namePlanPrompt}"`).toString().trim());

                const researchContent = fs.readFileSync(latestResearchFile, 'utf8');
                const planPrompt = getPrompt('plan').replace('{{research}}', researchContent);
                const nextPlanFileName = getNextPlanVersion(planDir, planName);
                const outputFile = path.join(planDir, nextPlanFileName);

                console.log(chalk.blue(`\nGenerating new plan based on latest research from ${latestResearchFile}...`));
                console.log(chalk.blue(`Saving plan to: ${outputFile}`));

                const geminiProcess = spawn('gemini', [planPrompt], { stdio: ['inherit', 'pipe', 'pipe'] });
                let planOutput = '';
                geminiProcess.stdout.on('data', (data) => {
                    planOutput += data.toString();
                });
                geminiProcess.stderr.on('data', (data) => {
                    console.error(chalk.red(data.toString()));
                });

                await new Promise((resolve, reject) => {
                    geminiProcess.on('close', (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`Gemini process exited with code ${code}`));
                        }
                    });
                });

                fs.writeFileSync(outputFile, planOutput);
                console.log(chalk.green(`Plan generated and saved to ${outputFile}`));
            }
        } catch (error) {
            console.error(chalk.red(`Error during plan command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program
    .command('implement <planFile> <phaseRequest> <targetFile>')
    .description('Generates code based on a plan file, a phase request, and a target file.')
    .argument('<planFile>', 'The path to the plan file (e.g., "thoughts/plans/plan-v1.md").')
    .argument('<phaseRequest>', 'A description of the specific phase or component to implement.')
    .argument('<targetFile>', 'The absolute or relative path to the file where the generated code should be saved (e.g., "src/components/MyComponent.js").')
    .action(async (planFile, phaseRequest, targetFile) => {
        try {
            if (!fs.existsSync(planFile)) {
                console.error(chalk.red(`Error: Plan file not found at ${planFile}`));
                process.exit(1);
            }

            const planContent = fs.readFileSync(planFile, 'utf8');
            const implementPrompt = getPrompt('implement')
                .replace('{{plan}}', planContent)
                .replace('{{phaseRequest}}', phaseRequest)
                .replace('{{targetFile}}', targetFile);

            const absoluteTargetFile = path.resolve(targetFile);
            fs.ensureDirSync(path.dirname(absoluteTargetFile));

            console.log(chalk.blue(`\nImplementing phase "${phaseRequest}" based on plan ${planFile}...`));
            console.log(chalk.blue(`Saving code to: ${absoluteTargetFile}`));

            const geminiProcess = spawn('gemini', [implementPrompt], { stdio: ['inherit', 'pipe', 'pipe'] });
            let implementOutput = '';
            geminiProcess.stdout.on('data', (data) => {
                implementOutput += data.toString();
            });
            geminiProcess.stderr.on('data', (data) => {
                console.error(chalk.red(data.toString()));
            });

            await new Promise((resolve, reject) => {
                geminiProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Gemini process exited with code ${code}`));
                    }
                });
            });

            fs.writeFileSync(absoluteTargetFile, implementOutput);
            console.log(chalk.green(`Implementation complete and saved to ${absoluteTargetFile}`));
        } catch (error) {
            console.error(chalk.red(`Error during implement command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program
    .command('validate <planFile> <codeDir>')
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
            const geminiProcess = spawn('gemini', [validatePrompt, `@${absoluteCodeDir}`], { stdio: 'inherit' });

            await new Promise((resolve, reject) => {
                geminiProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(chalk.green('Validation complete.'));
                        resolve();
                    } else {
                        reject(new Error(`Gemini process exited with code ${code}`));
                    }
                });
            });
        } catch (error) {
            console.error(chalk.red(`Error during validate command: ${error.message}`));
            if (error.stderr) {
                console.error(chalk.red(error.stderr));
            }
            process.exit(1);
        }
    });

program.parse(process.argv);
