# Git Checkout Main and Branch with Version Number

Switch to main branch first, then create a new branch with automatic version naming.

## Steps

1. Remember the current branch name
2. Run `git checkout main` to switch to main branch
3. Find the current version number from package.json, VERSION file, or git tags
4. Increment the version number (patch, minor, or major based on $ARGUMENTS, default to patch)
5. Run `git checkout -b release/v<new-version>` to create and switch to the new version branch
