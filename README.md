# Fine Print

The Fine Print start page is served at `/`. The document workspace is at `/documents`.

## Run locally

1. Install Node.js 18 or newer.
2. Install dependencies with `npm install`.
3. Add your Hack Club AI API key to `.env.local`:

   ```dotenv
   HACKCLUB_AI_API_KEY=your_key_here
   ```

4. Start the server with `npm start`, then open `http://localhost:3000`. Choose a file or paste text to jump into the workspace.

The key is read only by the server and `.env.local` is excluded from version control. The assistant uses Hack Club's OpenAI-compatible Chat Completions endpoint with `openai/gpt-4o-mini`; it does not call another AI provider. Supported inputs are text, Markdown, and text-based PDFs up to 8 MB. Text is limited to 100,000 characters. Uploaded documents are sent to Hack Club AI only after requesting an analysis or asking a question.

Run the server tests with `npm test`.

## Hackathon demo setup

The public front page can live on GitHub Pages, but Pages cannot run the Node server or the AI API. This project uses two hosts:

- `koditra.xyz` serves the static pitch page from GitHub Pages.
- `app.koditra.xyz` serves the working app and its server-side AI route from your VM.

The pitch page's file and paste links point to `app.koditra.xyz`. The Hack Club API key stays on the VM in `.env.local`, never in GitHub Pages or browser code.

### GitHub Codespaces

1. Push this repository to `github.com/koditra/fineprint`.
2. On GitHub, open the repository and choose **Code → Codespaces → Create codespace on main**.
3. In the Codespaces terminal, run `npm ci`, then `npm test`.
4. To try the app, add `HACKCLUB_AI_API_KEY` as a Codespaces secret in your GitHub settings, restart the Codespace, and run `npm start`. Open forwarded port 3000 in the Ports tab.

Codespaces is a cloud development environment; it is not the always-on production server.

### GitHub Pages for `koditra.xyz`

The workflow in `.github/workflows/pages.yml` publishes only `index.html`, so server code and local configuration are not published.

1. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the deployment source.
2. In the Pages settings, add `koditra.xyz` as the custom domain.
3. In GoDaddy DNS, point the apex (`@`) to GitHub Pages with these four A records:

   ```text
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

   Remove any GoDaddy parking records that conflict. Add a `www` CNAME to `koditra.github.io` if you want `www.koditra.xyz` too. See [GitHub's custom-domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
4. Wait for DNS to update, then enable **Enforce HTTPS** in the Pages settings.

### Run the app on the VM

The Nest dashboard says the VM is reachable as `ash@hackclub.app` and that custom domains should point to `ash.hackclub.app`. Connect from your computer's terminal:

```sh
ssh ash@hackclub.app
```

On Debian, install Git and Node.js 18 or newer, then clone the app:

```sh
sudo apt update
sudo apt install -y git nodejs npm
node --version
git clone https://github.com/koditra/fineprint.git
cd fineprint
npm ci
nano .env.local
chmod 600 .env.local
```

Put `HACKCLUB_AI_API_KEY=your_key_here` in `.env.local` using the editor; never paste the real key into chat or commit it. Then start the app with `npm start`. The server listens on `PORT` if set, otherwise port `3000`.

In the Nest dashboard, add `app.koditra.xyz` under **Domains** and set its target port to `3000` (or set `PORT` to match another target port). In GoDaddy DNS, add an `app` CNAME pointing to `ash.hackclub.app`, as Nest requires. Keep the app process running with the VM's project runner or a process manager such as systemd. Once DNS has updated, `https://app.koditra.xyz` should open the working app.