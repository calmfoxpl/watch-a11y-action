# Calmfox Watch – accessibility check for GitHub Actions

**English** · [Polski](README.pl.md)

Runs a digital accessibility check (WCAG, level A or AA) on selected pages of your website
after each deployment, and fails the build when the score drops below your threshold or a
**new** critical issue appears. The score and a table of the most important issues go to the
job summary; details and fix instructions are in the [Calmfox Watch](https://watch.calmfox.net)
panel.

Requires the **digital accessibility** module (Accessibility Pro add-on or the Complete plan).

## Keys

In the panel go to **Integrations → Releases** and turn on the release address. You get a site
token and a secret (the secret is shown only once). Store both in your repository as Actions
secrets: `CALMFOX_WATCH_TOKEN` and `CALMFOX_WATCH_SECRET`. These are the same keys as for the
release webhook — if you already use it, you only need to add the token.

## Example

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # … your deployment steps …

      - name: Digital accessibility
        id: a11y
        uses: calmfoxpl/watch-a11y-action@v1
        with:
          token: ${{ secrets.CALMFOX_WATCH_TOKEN }}
          secret: ${{ secrets.CALMFOX_WATCH_SECRET }}
          threshold: 80
          level: AA
          urls: |
            /
            /cart
            /contact

      - name: Report link
        if: always()
        run: echo "Report: ${{ steps.a11y.outputs.report-url }}"
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `token` | — | Site token (required). |
| `secret` | — | Release webhook secret (required). |
| `threshold` | `80` | Minimum score, 0–100. |
| `level` | `AA` | WCAG level: `A` or `AA`. |
| `urls` | addresses from the panel | Up to 10 paths on the site's domain. Empty = the home page and the addresses chosen in the accessibility setup. |
| `timeout` | `300` | How many seconds to wait for the result. |
| `fail-on-error` | `true` | `false` = do not fail the build when the check could not run (rate limit, outage, timeout). |
| `api-url` | `https://watch.calmfox.net` | Service address. |

## Outputs

`score`, `passed` (`true`/`false`), `report-url`, `check-id`.

## When the check passes

- the score on the checked addresses is ≥ `threshold`, **and**
- there are no new critical issues — ones the panel does not already know as open or muted.

The score uses the same formula as the panel, but counts only WCAG rules up to the chosen
level (best practices and AAA never fail the build), and rules muted in the panel do not
deduct points. Known critical issues lower the score but do not block a deployment on their
own — otherwise the gate would have to be switched off on day one.

A CI check **does not change** anything in the panel (findings, score, trend) — it is a gate
for your pipeline. AI review of images is off in CI; interaction tests (keyboard, zoom, forms)
run as in a regular check.

## Without GitHub Actions (curl)

The same check works from any CI (GitLab, Bitbucket, Jenkins…):

```bash
ID=$(curl -sS -X POST https://watch.calmfox.net/api/public/ci/a11y \
  -H "X-Calmfox-Hook: $CALMFOX_WATCH_TOKEN" \
  -H "X-Calmfox-Secret: $CALMFOX_WATCH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 80, "level": "AA", "urls": ["/", "/cart"]}' | jq -r .id)

curl -sS https://watch.calmfox.net/api/public/ci/a11y/$ID \
  -H "X-Calmfox-Hook: $CALMFOX_WATCH_TOKEN" \
  -H "X-Calmfox-Secret: $CALMFOX_WATCH_SECRET"
```

Status response: `status` (`queued` → `running` → `done`/`failed`), `score`, `passed`,
`critical`, `criticalNew`, `issues` (up to 10: `rule`, `title`, `impact`, `count`, `pages`,
`new`), `pages`, `reportUrl`. Limit: 30 checks per hour per site.

Send the keys only in headers — a request with a key in the URL gets 400.

## Development

No dependencies (Node 20). Tests: `node --test index.test.js`.

## License

MIT — see [LICENSE](LICENSE).
