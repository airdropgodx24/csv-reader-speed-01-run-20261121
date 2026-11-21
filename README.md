# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/airdropgodx24/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/airdropgodx24/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

An entry for [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
("Read broken CSV files faster, 21 November 2026").

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
what csv-reader 1.0.0 returns for the same input: `{columns, rows, errors}`
for `{text, header}`, following its broken-row policy (BOM dropped, CRLF/LF
record ends, stray CRs dropped with an error, quoted fields with `""`
escapes and LF-normalised line breaks inside, junk after a closing quote
appended, unterminated quotes re-read as unquoted, short/long rows padded or
cut to the first record's width).

It is faster than the reference because it reads the text once, left to right,
but finds each field's end with `indexOf` and takes the field out with one
slice, instead of building every field one character at a time. Anything
unusual (a stray CR, a line break inside quotes) falls back to a small loop
over just that field or segment.

`main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each one alone with `run()`, and writes
`/output/answers.json`.

## How to run it

```sh
node main.ts
```

Outside a container, point it at a cases file with `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR`:

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

Requires Node 22 or later.

## License

MIT. See [LICENSE](LICENSE).
