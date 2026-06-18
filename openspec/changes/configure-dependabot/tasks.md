## 1. Add Dependabot Configuration

- [x] 1.1 Create `.github/dependabot.yml` with npm ecosystem entry (weekly, root directory, Cloudflare group, MCP group)
- [x] 1.2 Add github-actions ecosystem entry to `.github/dependabot.yml` (weekly, root directory)

## 2. SHA-Pin GitHub Actions

- [x] 2.1 Resolve current commit SHAs for all Actions at their current tags: `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v4`, `actions/upload-pages-artifact@v5`, `actions/configure-pages@v6`, `actions/deploy-pages@v5`, `cloudflare/wrangler-action@v4`
- [x] 2.2 Replace all `@vN` Action refs with `@<sha> # vN.M.P` in `ci.yml`
- [x] 2.3 Replace all `@vN` Action refs with `@<sha> # vN.M.P` in `data-build-indexes.yml`
- [x] 2.4 Replace all `@vN` Action refs with `@<sha> # vN.M.P` in `data-build-plugin.yml`
- [x] 2.5 Replace all `@vN` Action refs with `@<sha> # vN.M.P` in `data-build-site.yml`
- [x] 2.6 Replace all `@vN` Action refs with `@<sha> # vN.M.P` in `data-deploy.yml`
- [x] 2.7 Replace all `@vN` Action refs with `@<sha> # vN.M.P` in `data-onboard.yml`
- [x] 2.8 Replace all `@vN` Action refs with `@<sha> # vN.M.P` in `data-revoke.yml`

## 3. Verify and Commit

- [x] 3.1 Confirm all workflow files parse as valid YAML (no syntax errors from the SHA substitutions)
- [x] 3.2 Commit changes and push to branch
