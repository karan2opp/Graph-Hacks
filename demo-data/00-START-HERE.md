# Test data: Meera Sharma v. Anil Verma (synthetic)

All names, dates and numbers are made up. A property dispute: Meera paid Rs. 8,00,000 as advance for Flat B-204 under an Agreement to Sell. The defendant first says he never received any money, then says it was a loan.

Make sure `OPENAI_API_KEY` is set in `server/.env`, otherwise documents are saved but the agents cannot read them.

## 1. New case, step 1: case details

| Field | Enter |
|---|---|
| Case number | `O.S. 245/2022` |
| Court | `Civil Judge (Sr. Div.), Saket Courts, New Delhi` |
| Title | `Meera Sharma v. Anil Verma` |
| Type | Civil |
| Stage | Pleadings |
| Filed on | 14-02-2022 |

## 2. Step 2: people

| Side | Party | Role | Lawyer | Witnesses |
|---|---|---|---|---|
| Plaintiff | Meera Sharma | Plaintiff | Adv. Rohan Kapoor | `PW1 Deepak Arora` |
| Defendant | Anil Verma | Defendant | Adv. Neha Bansal | (none) |

Presiding judge: `Ms. Kavita Malhotra`

## 3. Step 3: hearings

Add the first hearing, then use "Add a hearing" for the rest. All are in the past, so choose **Heard** (or Adjourned where noted). Tick who was present.

| Date | Listed for | Outcome |
|---|---|---|
| 15-03-2022 | Appearance | Heard (present: Adv. Rohan Kapoor only) |
| 10-05-2022 | Written statement | **Adjourned** at the request of Anil Verma, reason: `Defendant abroad; costs Rs. 3,000` (present: both lawyers) |
| 12-07-2022 | Framing of issues | Heard |
| 07-02-2023 | Plaintiff evidence | Heard. Next hearing: 04-12-2026, listed for `Defendant evidence` |

## 4. Add to the case memory (Add material)

Upload in this order. Each time, choose the type and fill the dates; "Filed by" is the party who filed it. The agents read each one in the background, so give each a few seconds.

| File | Tab | What is it? | Filed by | Hearing | Date of the document | Filed in court on |
|---|---|---|---|---|---|---|
| `01-plaint.pdf` | Upload file | Plaint | Meera Sharma | - | 14-02-2022 | 14-02-2022 |
| `03-order-2022-03-15.pdf` | Upload file | Order | - | 15-03-2022 | (default) | (default) |
| `02-agreement-to-sell.pdf` | Upload file | Agreement | Meera Sharma | - | **10-01-2022** | **28-04-2022** |
| `transcript-2022-05-10.txt` | Hearing transcript | (paste or open the file) | | 10-05-2022 | | |
| `04-order-2022-05-10.pdf` | Upload file | Order | - | 10-05-2022 | (default) | (default) |
| `05-written-statement.pdf` | Upload file | Written statement | Anil Verma | - | 20-06-2022 | 20-06-2022 |
| `order-photo-2022-07-12.png` | Upload file | Order | - | 12-07-2022 | (default) | (default) |
| `transcript-2023-02-07.txt` | Hearing transcript | | | 07-02-2023 | | |
| `06-affidavit-of-anil-verma-dw1.pdf` | Upload file | Affidavit | Anil Verma | - | 12-06-2023 | 12-06-2023 |

The `.png` is a photo of an order: it tests the image reader (OCR). The `.txt` transcripts can be pasted into the "Hearing transcript" tab.

## 5. What you should see

**Contradictions (Story drift / findings)**
- **Anil Verma, himself:** written statement (no money ever received, signature forged) against his affidavit (received Rs. 8,00,000 as a loan; signed a paper believing it was a loan receipt).
- **Against the record:** his written statement against the Agreement to Sell (acknowledges receipt of Rs. 8,00,000).
- **Same side:** PW1 says the payment was on **14 January 2022 in the defendant's office**; the plaint and the agreement say **10.01.2022**. (If you also upload the FIR to this case, it says "at his flat".)
- **Disputes (not contradictions):** the plaintiff says she paid; the defendant denies it.

**Directions and compliance**
- Process fee (order of 15.03): complied, evidenced by the 10.05 order.
- Original agreement before 10.05.2022: **complied on time** (filed 28.04.2022, even though the document is from January).
- Written statement: complied **late** (filed 20.06.2022; the last opportunity ended 24.05.2022).
- Costs of Rs. 3,000: **overdue**, and the 12.07.2022 order repeats it. Try the manual override ("paid in cash in court").
- Replication within three weeks (plaintiff): **overdue**.
- Status quo: **in force**.

**Ask the case** (try these)
1. `List all the orders from the hearing on 10 May 2022.`
2. `What has Anil Verma said about the Rs. 8 lakh?`
3. `Has the defendant contradicted himself?`
4. `Which directions are overdue?`
5. Follow-up: `What did his lawyer say about the delay?`
6. `What is Anil Verma's phone number?` (should say it is not in the record)

## 6. The linked criminal case (optional)

Create a second case: number `FIR 112/2022 / Crl. Case 88/2023`, court `ASJ, Saket Courts, New Delhi`, title `State v. Anil Verma`, type **Criminal**, stage Filing. People: Meera Sharma (role **Complainant**) and Anil Verma (role **Accused**). Upload `07-fir-112-2022.pdf` as an **FIR** filed by Meera Sharma, dated 03-08-2022. The FIR is the same story told to the police.
