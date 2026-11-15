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
3. In GoDaddy DNS, point the apex (`@`) to GitHub Pages using the A records in [GitHub's custom-domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
4. Add an `app` A record pointing to your VM's public IPv4 address. Add a `www` CNAME to `koditra.github.io` if you want `www.koditra.xyz` too.
5. Wait for DNS to update, then enable **Enforce HTTPS** in the Pages settings.

### Run the app on the VM

These steps assume the VM is reachable as `ash@hackclub.app` and runs Ubuntu or a similar Linux distribution. If that is the SSH login you were given, connect from your computer's terminal:

```sh
ssh ash@hackclub.app
```

Install Node.js 18 or newer and Git on the VM, then clone and start the app:

```sh
git clone https://github.com/koditra/fineprint.git
cd fineprint
npm ci
nano .env.local
chmod 600 .env.local
npm start
```

Put `HACKCLUB_AI_API_KEY=your_key_here` in the `.env.local` file in the editor; do not paste the real key into chat or commit it. The VM's firewall should allow HTTP and HTTPS. Point Nginx (or your VM provider's reverse proxy) for `app.koditra.xyz` to `http://127.0.0.1:3000`, then enable HTTPS there. For a real demo, run Node under a process manager such as systemd so it restarts after logout or reboot.

The DNS setup needs your VM's public IPv4 address, and the VM steps need working SSH access. If `ssh ash@hackclub.app` is not the actual login command, use the SSH host and username shown by your VM provider.