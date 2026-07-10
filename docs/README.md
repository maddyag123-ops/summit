# Summit Docs

## Block System Reference

`block-types.js` generates the Summit Block System Reference Word document.

### To regenerate after edits:

```
npm install docx
node block-types.js
```

Edit the `blocks` array, `DISCIPLINE_PATHS`, or `GENERAL_PRINCIPLES` at the top of the file. Each block has six fields: label, weeks, deload, context, ewma, assessment.
