# gemini-phased-workflow (gpfw)

`gpfw` is a globally-installable NPM command-line tool designed to standardize and streamline a 4-phase coding workflow (Research, Plan, Implement, Validate) using the Gemini CLI. It helps developers manage their thought process and code generation in a structured manner.

## Features

*   **Research**: Conduct research on a given goal using Gemini and save the output.
*   **Plan**: Generate a detailed plan based on the latest research, with options for interactive refinement.
*   **Implement**: Generate code based on a plan, a specific phase request, and a target file.
*   **Validate**: Review generated code against a plan and provide a validation report.

## Installation

To install `gpfw` globally, run:

```bash
npm install -g gemini-phased-workflow
```

## Usage

The `gpfw` tool guides you through a four-phase workflow. All generated files are stored in a `thoughts/` directory within your project.

### 1. Research

Start by researching your project goal. This will generate a research document in `thoughts/research/`.

```bash
gpfw research "Your project goal, e.g., How to implement a dark mode toggle in a Gatsby React application using Material-UI?"
```

### 2. Plan

Generate a detailed plan based on your latest research. This will create a `plan-vX.md` file in `thoughts/plans/`.

```bash
gpfw plan "A high-level description of the plan, e.g., Create a dark mode toggle"
```

**Refining a Plan:**

You can also refine an existing plan interactively. This will launch an interactive Gemini session. You will need to manually save the refined plan after the session.

```bash
gpfw plan thoughts/plans/plan-v1.md
```

### 3. Implement

Generate code for a specific phase of your plan and save it to a target file.

```bash
gpfw implement <path-to-plan-file> "Description of the phase to implement" <path-to-target-file>
# Example:
gpfw implement thoughts/plans/plan-v1.md "Implement the DarkModeToggle component" src/components/DarkModeToggle.js
```

### 4. Validate

Review the generated code against your plan. The validation report will be printed to the console.

```bash
gpfw validate <path-to-plan-file> <path-to-code-directory>
# Example:
gpfw validate thoughts/plans/plan-v1.md src/components/
```

## Development

### Local Installation for Development

To link your local `gpfw` development version globally:

```bash
cd /path/to/gemini-phased-workflow
npm link
```

### Updating Prompts

The prompts used by `gpfw` are located in the `templates/` directory. You can modify these files to customize the behavior of the tool.

## Contributing

(Add contributing guidelines here)

## License

ISC
