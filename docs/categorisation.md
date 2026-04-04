My honest take: do **not** start with “send the whole PDF to an LLM every month.”
The strongest setup here is a **hybrid pipeline**:

`XLS as source of truth -> normalize -> rules/aliases -> historical lookup -> small local model -> LLM fallback -> FinWise create API`

That fits your current Cloudflare flow well, keeps costs low, and will get smarter over time.

The reason I’d do it this way is that your sample statement already has a lot of deterministic signal. On pages 2–3 of the PDF, the row text includes merchant strings, location, wallet/channel hints, and useful memo text like “TFSA”, “CPT flights”, “Kruger trip”, and “Mortgage Add April”. Your category set is also fairly specific — things like Coffee, Work Eats, Groceries, Clothing, Mortgage, Donations, Savings, Transfers, Vacation & Travel, and Salaries & Wages — so a lot of rows can be mapped without an LLM at all.  

A good first layer is **merchant normalization + alias rules**. Plaid describes merchant parsing and location parsing as the core enrichment problem, and notes that many transaction strings do not need a heavy model at all — a light fuzzy-matching step is often enough when the descriptor is obvious. ([Plaid][1])
So normalize things like:

* lowercase
* strip branch/store numbers
* remove wallet/channel noise like `apple pay on ...`
* collapse `yoco *father coffee` and `yoco *plato coffee` into stable merchant names
* split out memo tokens like `tfsa`, `mortgage`, `salary`, `trip`

With just that, I’d expect examples like these to fall out pretty fast from your sample:

* `Seattle Liberty`, `Starbucks Fx Melrose A`, `Naked Coffee - Illovo`, `Yoco *father Coffee`, `Yoco *plato Coffee` -> **Coffee**
* `Tsafrika Headoffice` -> probably **Work Eats**
* `H&m Cresta Mall`, likely `Pnp Clt Cresta` -> **Clothing**
* `Superspar Blackheath` -> **Groceries**
* `Standard bank ... SAL ...` -> **Salaries & Wages**
* `Carina Van Der Colff` with memo `TFSA` -> **Investments**
* `Carina Van Der Colff` with memo `Mortgage Add April` -> **Mortgage**
* `Gods Money` -> **Donations**
* `Emergency Savings` / `Travel Savings` -> **Savings** or **Transfers**, depending on how you want internal buckets treated.  

The next layer should be **historical retrieval**, because your categories are personal. `Tsafrika Headoffice -> Work Eats` is exactly the kind of mapping that generic AI can miss, but your own history will learn immediately. FinWise’s API supports bulk `GET /transactions` with pagination, and the search filter does wildcard matching across transaction description and merchant name. The transaction object also exposes both `transactionCategoryId` and `originalTransactionCategoryId`, which is useful for learning from later manual corrections. ([finwiseapp.io][2])

That means you can build a very solid **no-token-cost classifier** from your own data:

* exact normalized merchant match -> use prior category
* fuzzy merchant match -> use majority category if consistent
* same counterparty + memo token -> use prior category
* then a lightweight model on top of your history

For the model, I would start very plain: **TF-IDF over normalized description + memo + sign + amount bucket**, then logistic regression or linear SVM. You do not need anything fancy first. In messy transaction strings, simple text models plus your own labels usually beat generic models surprisingly quickly once you have enough corrected history.

Then use an **LLM only as the fallback**, not the main engine. If you go the Gemini route, use structured output / JSON schema or function calling so the model can only return a valid category choice plus confidence and rationale. Google’s Gemini docs explicitly support structured outputs for predefined classifications and function calling for external tool/data workflows. ([Google AI for Developers][3])
Crucially, send it **one normalized transaction row**, not the whole PDF. For example:

```json
{
  "description": "carina van der colff",
  "memo": "mortgage add april",
  "amount": -11500,
  "direction": "debit",
  "location": null,
  "allowedCategories": ["Mortgage", "Transfers", "Friends & Family", ...]
}
```

That is cheaper, more deterministic, and easier to debug than monthly full-document vision prompts.

So between your two ideas:

* **Pure PDF + AI first:** fastest to prototype, but higher cost and lower determinism.
* **Pure historical ML first:** cheapest long-term, but weaker on day 1 if you do not have enough labeled examples.

My recommendation is the middle path: **rules + historical retrieval first, local model second, LLM fallback last**.

One more practical point: querying categories dynamically is the right idea, because FinWise categories are user-customizable. I would just do it **once per batch/file**, not once per transaction. FinWise’s docs say categories can be created, edited, and deleted, so keeping the enum dynamic is correct. ([finwiseapp.io][5])

Given the public FinWise API docs, I found documented transaction endpoints for create, list, aggregated, and archive, and I did **not** find a documented transaction update endpoint. That makes correct categorization at ingest time more important, and it argues for a confidence threshold: high confidence -> categorize; low confidence -> leave as Unknown and log for review. ([finwiseapp.io][2])


[2]: https://finwiseapp.io/docs/api "FinWise API Reference | FinWise"
[3]: https://ai.google.dev/gemini-api/docs/structured-output?utm_source=chatgpt.com "Structured outputs | Gemini API | Google AI for Developers"
[5]: https://finwiseapp.io/docs/hub/categories "Categories | FinWise Hub"
