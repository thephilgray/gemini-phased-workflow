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
            const planName = sanitizeForFilename(execSync(`gemini "${namePlanPrompt}"`).toString().trim());

            const planPrompt = getPrompt('plan').replace('{{research}}', researchContent);
            const nextPlanFileName = getNextPlanVersion(planDir, planName);
            const outputFile = path.join(planDir, nextPlanFileName);

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

                const geminiProcess = spawn('gemini', ['-i', refinePrompt], { stdio: 'inherit' });

                geminiProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(chalk.green(`\nInteractive refinement session closed.`));
                    } else {
                        console.error(chalk.red(`Interactive refinement session exited with code ${code}`));
                    }
                    process.exit(code);
                });
            } else {
                console.log(chalk.blue(`\nRefining plan: ${planFile}...`));
                const geminiProcess = spawn('gemini', [refinePrompt], { stdio: ['inherit', 'pipe', 'pipe'] });
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

            const geminiProcess = spawn('gemini', [implementPrompt], { stdio: 'inherit' });

            await new Promise((resolve, reject) => {
                geminiProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Gemini process exited with code ${code}`));
                    }
                });
            });
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
            const geminiProcess = spawn('gemini', [validatePrompt, `@${absoluteCodeDir}`], { stdio: 'inherit' });

            await new Promise((resolve, reject) => {
                geminiProcess.on('close', (code) => {
                    if (code === 0) {
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
