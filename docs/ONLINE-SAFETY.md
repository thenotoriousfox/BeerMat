# Online Safety Act: risk assessment (draft)

**Status:** draft for the service owner to check, complete and sign off. Not legal advice; check it against Ofcom's
current guidance (links at the end) before relying on it.

| | |
|---|---|
| Service | BeerMat Online (`online.beermatquiz.co.uk`), with the BeerMat phone app and the quiz desk's online features |
| Provider | Daniel Weatherall, trading as BeerMat, Flat Above, 5 Albert Street, Derby DE1 2DS |
| Accountable person | Daniel Weatherall (hello@beermatquiz.co.uk) |
| Drafted | 28 October 2026 |
| Next review | 28 October 2027, or before any significant change (see section 7), whichever is first |

## 1. Why the Act applies

The Online Safety Act 2023 covers **user-to-user services** with links to the UK: services where content one user
generates can be encountered by other users. BeerMat Online is aimed at UK pubs and players, and has a few such
features:

| Feature | Who creates the content | Who can see it |
|---|---|---|
| Venue pages and quiz nights (name, address, website, event titles and details) | A venue's operator (an account an admin has linked to the venue) | Anyone: website, app, map. Only Pro venues an admin has approved are listed. |
| Player display names and profile pictures on leaderboards | Players | Anyone, only if the player opts in (leaderboards and photo are both off by default); only results from venues an admin has verified count |
| Team names in results a venue shares | Teams at a quiz night (checked by the desk's offensive-name filter) | Admins only |
| Shared buzzer library: clip names | Pro venues | Anyone using the quiz desk |
| Shared buzzer library: the clips | Pro venues | Pro venues' quiz desks |
| Quiz library: titles, descriptions, round titles | Pro venues (and BeerMat) | Anyone using the quiz desk, after an admin approves the quiz |
| Quiz library: the questions, pictures and sounds | Pro venues (and BeerMat) | Admins before approval; Pro venues' quiz desks after |

There is **no** private messaging, chat, comments, posts, livestreaming, groups, or search across users, and no way
for a player to send anything to another player through BeerMat Online.

**Not part of this assessment:**

- **Quiz nights themselves.** They run on the venue's own laptop, on its own Wi-Fi or through a link it opens itself
  (a Cloudflare tunnel from that laptop); BeerMat provides the software, and nothing passes through BeerMat Online.
  The desk still filters offensive team names and holds team photos until the quizmaster approves them.
  *Check:* whether Ofcom would see BeerMat or the venue as the provider of a venue's online quiz.
- **The website** (`beermatquiz.co.uk`): BeerMat's own content only.
- **Copyright.** Infringing copyright isn't "illegal content" under the Act. It's handled by the terms, the report
  buttons and takedown by email (see the shared buzzer library section of `docs/ONLINE.md`).

## 2. Size

BeerMat Online is a **small service** (far below the 7 million UK users that make a service "large"), so the codes'
measures for small services apply.

## 3. Illegal content risk assessment

Following Ofcom's four steps: understand the harms, assess the risk of each, decide the measures, and record and review.

**Risk factors from Ofcom's risk profiles that BeerMat Online has:** user profiles (display name, optional picture);
users can post images (a profile picture, 200 KB at most) and audio (buzzer clips, 10 seconds, Pro venues only);
venue operators publish text. **That it doesn't have:** messaging, comments, livestreaming, groups, anonymous posting
to others, recommender feeds, search of user content, or encrypted messaging.

**Who can post anything others see** is limited: venue pages and clips come only from venues, which an admin links or
which paid by card (so they're known and traceable); players' names and pictures appear only on leaderboards they've
chosen to join.

| Kind of illegal harm (Ofcom's priority list) | How it could happen here | Likelihood | Impact | Risk |
|---|---|---|---|---|
| Terrorism | Text on a venue page; a buzzer clip | Very unlikely: venues are known, paying businesses | Could be serious | Low |
| Child sexual exploitation and abuse: images (CSAM) | A profile picture shown on a leaderboard | Very unlikely: opt-in, small images, few viewers | Severe | Low |
| Child sexual exploitation and abuse: grooming | Needs a way to contact a child; there isn't one | Negligible | — | Negligible |
| Hate | A display name, team name, venue text or buzzer clip | Unlikely | Moderate | Low |
| Harassment, stalking, threats and abuse | A display name or picture aimed at someone; there's no messaging | Unlikely | Moderate | Low |
| Controlling or coercive behaviour | No contact between users | Negligible | — | Negligible |
| Intimate image abuse | A profile picture | Very unlikely (as for CSAM) | Severe | Low |
| Extreme pornography | A profile picture | Very unlikely | Moderate | Low |
| Sexual exploitation of adults; human trafficking; unlawful immigration | Would need advertising or contact between users; neither exists | Negligible | — | Negligible |
| Fraud and financial services | A fake venue or a misleading quiz night (for example a fake prize or entry fee) | Unlikely: venues are added by an admin or bought by card, and approved before they're listed | Moderate | Low |
| Proceeds of crime | No payments between users | Negligible | — | Negligible |
| Drugs and psychoactive substances; firearms, knives and other weapons | Venue page text | Very unlikely | Moderate | Low |
| Encouraging or assisting suicide or self-harm | A buzzer clip or display name | Very unlikely | Severe | Low |
| Foreign interference | Nothing political to post into | Negligible | — | Negligible |
| Animal cruelty | A profile picture or clip | Very unlikely | Moderate | Low |
| Other illegal content | As above | Very unlikely | Varies | Low |

**Conclusion:** low or negligible risk for every kind of illegal harm, so BeerMat Online is a **small, low-risk
service**.

## 4. Measures in place

What Ofcom's codes ask of a small, low-risk user-to-user service, and how BeerMat Online does it:

| Measure | How BeerMat Online meets it |
|---|---|
| A named person accountable for online safety | Daniel Weatherall (table above) |
| A way to review and take down illegal content quickly | The admin console: remove a venue, cancel a quiz night, remove a profile picture, delete an account, hide or remove a buzzer clip, stop a venue sharing clips |
| Users can report content easily | Report on a venue page (app); Report on a buzzer clip (quiz desk); players on leaderboards through `POST /v1/reports {kind: 'profile'}`; email hello@beermatquiz.co.uk for anything. Reports appear in the admin console's Reports tab |
| Swift action | A buzzer clip three venues report is hidden by itself and BeerMat is emailed; reports are checked at least weekly (the console's overview shows how many are waiting) |
| Terms say how users are protected | `beermatquiz.co.uk/terms`: what's not allowed, reporting, removal of content and accounts |
| Complaints, including appeals against removals | The terms' "Reports, complaints and appeals" section: reports looked at within days, appeals within 28 days answered within 14, complaints answered within 14 days, and Ofcom named |
| No proactive scanning | Not needed for a small, low-risk service |

## 5. Gaps to close

1. **Leaderboards aren't shown anywhere yet** (only the public `GET /v1/leaderboards` feed). Reporting is ready:
   each player there has a `ref`, and `client.reportPlayer(ref, reason)` reports them. A screen that shows a
   leaderboard must have a Report button on each player. Until then, players are reported by email.
2. **Report checking.** Commit to looking at the admin console's Reports tab at least weekly, and soon after the
   email that a clip has been hidden.

## 6. Children's access assessment

The Act also requires a separate assessment of whether children are likely to use the service. If they are, a
children's risk assessment and the children's safety duties follow.

- **Can children use BeerMat Online?** Yes. Nothing checks age, and the phone app is free to download.
- **Are a significant number of its users children, or is it likely to attract them?** No. The reasons:
  - BeerMat is a pub quiz system. Its venues are pubs, its customers are the businesses running them, and only
    venues on Pro are listed, after an admin has checked them.
  - Nothing in it is aimed at children: no child-directed content, design or marketing, and it's sold to pubs.
  - Playing a quiz needs no account; an account is an optional extra, mostly for saving results from pub quizzes.
  - What players can show others is limited, and off by default (leaderboards, pictures, history).
- **Decision (28 October 2026):** the child user condition is **not met**, so BeerMat Online is not likely to be
  accessed by children, and the children's risk assessment and safety duties don't apply.
- **Re-check** at each review, and straight away if any of these changes: BeerMat is offered to schools, youth groups
  or family events; marketing reaches children; or there's evidence of many child users (for example, reports or
  accounts that look like children's). Keep any such evidence with this assessment.

## 7. Records and review

- Keep this assessment, each later version and the reports log (the `reports` table, kept in the nightly backups).
- Review it every year, and **before** any significant change, for example: messaging or chat between players,
  comments, public team photos, anything that lets players post for other players to see, or a big rise in users.

## Sources

- Ofcom, [Codes of practice: illegal harms](https://ofcom.org.uk/online-safety/illegal-and-harmful-content/codes-of-practice)
- Ofcom, [Risk assessment guidance and risk profiles](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/risk-assessment-guidance-and-risk-profiles.pdf)
- Ofcom, [Illegal harms: summary of decisions](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/summary-of-our-decisions.pdf)
- Osborne Clarke, [Ofcom publishes final illegal content risk assessment guidance](https://www.osborneclarke.com/insights/ofcom-publishes-final-illegal-content-risk-assessment-guidance-and-codes-practice-under-uk)
