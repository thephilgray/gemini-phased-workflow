# Publishing `gemini-phased-workflow` to NPM

To publish the `gemini-phased-workflow` package to NPM, please follow these steps:

1.  **Log in to NPM:**
    Run `npm login` in your terminal and follow the prompts to log in with your NPM account.

2.  **Publish the package:**
    Once logged in, run `npm publish` from within the `gemini-phased-workflow` directory. If you are using a scoped name (e.g., `@username/gemini-phased-workflow`), you might need to use `npm publish --access=public`.

3.  **Test Global Installation (Optional but Recommended):**
    After publishing, you can test the global installation:
    a.  Remove your local symlink: `npm unlink`
    b.  Install the package globally from NPM: `npm install -g gemini-phased-workflow`
    c.  Navigate to a new test project directory and run the `gpfw` commands to verify the full workflow.

4.  **Future Updates:**
    When you make changes and want to update the package, increment the version in `package.json` (e.g., `npm version patch`), and then run `npm publish` again.
