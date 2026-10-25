# The 12th Tide — GitHub + Vercel Deployment

This ZIP is already prepared for Vercel static hosting. The complete playable website is in `play/`.
Vercel configuration is in `vercel.json` at the repository root and serves `play/`.
You do NOT need Python, Node.js or npm to deploy the existing compiled game.

## GitHub Desktop (Windows)
1. Extract this archive into a folder named `The12thTide`.
2. Open GitHub Desktop (https://desktop.github.com/) and sign in.
3. File > Add local repository > Choose... the EXTRACTED `The12thTide` folder.
4. If told this isn't a repository, select **Create a repository here** and create it.
5. Commit all files (summary: `Initial The 12th Tide release`).
6. Click Publish repository. Choose public/private according to your preference.

## Vercel
1. Go to https://vercel.com/new and sign in with GitHub.
2. Import the GitHub repository you just published.
3. Select framework **Other**, root directory `./` (repository root).
4. Leave Build Command blank. Output Directory should resolve to `play` from the included `vercel.json`.
5. Deploy. If Vercel asks for settings anyway, manually set Output Directory to `play`.
6. Test the resulting HTTPS URL, including webcam permission in Chrome or Edge.

When you update the source code later, remember to regenerate/copy the compiled website into `play/` (or switch Vercel to build the TypeScript source); otherwise the public site will still show the previous version.
