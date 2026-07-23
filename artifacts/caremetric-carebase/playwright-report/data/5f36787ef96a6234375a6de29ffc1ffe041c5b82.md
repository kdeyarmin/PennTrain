# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public-smoke.spec.ts >> public release smoke journeys >> landing page exposes the primary conversion and sign-in paths
- Location: e2e/public-smoke.spec.ts:5:3

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 653

- Array []
+ Array [
+   Object {
+     "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
+     "help": "Elements must meet minimum color contrast ratio thresholds",
+     "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright",
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": Array [
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#fefefe",
+               "contrastRatio": 1.19,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#e7eaed",
+               "fontSize": "7.5pt (10px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.19 (foreground color: #e7eaed, background color: #fefefe, font size: 7.5pt (10px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div style=\"display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-bottom: 1px solid rgb(229, 234, 240); background: rgb(246, 248, 250);\">",
+                 "target": Array [
+                   "div:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.19 (foreground color: #e7eaed, background color: #fefefe, font size: 7.5pt (10px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<span style=\"margin-left: 8px; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.06em; color: rgb(100, 118, 138);\">CAREBASE / FACILITY COMMAND CENTER</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(1) > div:nth-child(1) > span:nth-child(4)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#fcfefc",
+               "contrastRatio": 1.21,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#ddebe0",
+               "fontSize": "8.3pt (11px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.21 (foreground color: #ddebe0, background color: #fcfefc, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<span style=\"background: rgb(234, 246, 236); color: rgb(30, 122, 53); font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; border-radius: 99px; padding: 4px 10px;\">50% compliant</span>",
+                 "target": Array [
+                   "div:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > span",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.21 (foreground color: #ddebe0, background color: #fcfefc, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span style=\"background: rgb(234, 246, 236); color: rgb(30, 122, 53); font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; border-radius: 99px; padding: 4px 10px;\">50% compliant</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > span",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#fffdfb",
+               "contrastRatio": 1.22,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#ede6d8",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.22 (foreground color: #ede6d8, background color: #fffdfb, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div style=\"background: rgb(253, 244, 227); border: 1px solid rgb(240, 217, 168); border-radius: 10px; padding: 10px 12px;\">",
+                 "target": Array [
+                   "div:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(3) > div:nth-child(3)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.22 (foreground color: #ede6d8, background color: #fffdfb, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span style=\"font-weight: 700; color: rgb(138, 90, 0);\">Expiring credentials</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(1) > div:nth-child(3) > div:nth-child(3) > div:nth-child(1) > span:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#fffdfb",
+               "contrastRatio": 1.22,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#ede6d8",
+               "fontSize": "8.3pt (11px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.22 (foreground color: #ede6d8, background color: #fffdfb, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div style=\"background: rgb(253, 244, 227); border: 1px solid rgb(240, 217, 168); border-radius: 10px; padding: 10px 12px;\">",
+                 "target": Array [
+                   "div:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(3) > div:nth-child(3)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.22 (foreground color: #ede6d8, background color: #fffdfb, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span style=\"color: rgb(138, 90, 0); font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700;\">3 due in 21 days</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(3) > div:nth-child(1) > span:nth-child(2)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#fffdfb",
+               "contrastRatio": 1.23,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#e9e5db",
+               "fontSize": "8.3pt (11px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.23 (foreground color: #e9e5db, background color: #fffdfb, font size: 8.3pt (11px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div style=\"background: rgb(253, 244, 227); border: 1px solid rgb(240, 217, 168); border-radius: 10px; padding: 10px 12px;\">",
+                 "target": Array [
+                   "div:nth-child(2) > div:nth-child(2) > div:nth-child(1) > div:nth-child(3) > div:nth-child(3)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.23 (foreground color: #e9e5db, background color: #fffdfb, font size: 8.3pt (11px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"margin-top: 7px; font-size: 11px; color: rgb(109, 83, 18);\">Act 34 clearance — J. Miller, R. Chen, T. Brooks · alert sent to facility manager</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(1) > div:nth-child(3) > div:nth-child(3) > div:nth-child(3)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#ffffff",
+               "contrastRatio": 1.21,
+               "expectedContrastRatio": "3:1",
+               "fgColor": "#dcebfa",
+               "fontSize": "30.0pt (40px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.21 (foreground color: #dcebfa, background color: #ffffff, font size: 30.0pt (40px), font weight: bold). Expected contrast ratio of 3:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section style=\"background: rgb(255, 255, 255); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "section:nth-child(3)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.21 (foreground color: #dcebfa, background color: #ffffff, font size: 30.0pt (40px), font weight: bold). Expected contrast ratio of 3:1",
+         "html": "<div style=\"font-family: &quot;Source Serif 4&quot;, Georgia, serif; font-size: 40px; font-weight: 800; color: rgb(220, 235, 250); line-height: 1;\">01</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "section:nth-child(3) > div > div:nth-child(2) > div:nth-child(1) > div:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#ffffff",
+               "contrastRatio": 1.21,
+               "expectedContrastRatio": "3:1",
+               "fgColor": "#dcebfa",
+               "fontSize": "30.0pt (40px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.21 (foreground color: #dcebfa, background color: #ffffff, font size: 30.0pt (40px), font weight: bold). Expected contrast ratio of 3:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section style=\"background: rgb(255, 255, 255); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "section:nth-child(3)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.21 (foreground color: #dcebfa, background color: #ffffff, font size: 30.0pt (40px), font weight: bold). Expected contrast ratio of 3:1",
+         "html": "<div style=\"font-family: &quot;Source Serif 4&quot;, Georgia, serif; font-size: 40px; font-weight: 800; color: rgb(220, 235, 250); line-height: 1;\">02</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "section:nth-child(3) > div > div:nth-child(2) > div:nth-child(2) > div:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#ffffff",
+               "contrastRatio": 1.21,
+               "expectedContrastRatio": "3:1",
+               "fgColor": "#dcebfa",
+               "fontSize": "30.0pt (40px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 1.21 (foreground color: #dcebfa, background color: #ffffff, font size: 30.0pt (40px), font weight: bold). Expected contrast ratio of 3:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section style=\"background: rgb(255, 255, 255); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "section:nth-child(3)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 1.21 (foreground color: #dcebfa, background color: #ffffff, font size: 30.0pt (40px), font weight: bold). Expected contrast ratio of 3:1",
+         "html": "<div style=\"font-family: &quot;Source Serif 4&quot;, Georgia, serif; font-size: 40px; font-weight: 800; color: rgb(220, 235, 250); line-height: 1;\">03</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "section:nth-child(3) > div > div:nth-child(2) > div:nth-child(3) > div:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 4.38,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#64768a",
+               "fontSize": "9.4pt (12.5px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.4pt (12.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section id=\"platform\" style=\"scroll-margin-top: 72px; background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "#platform",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.4pt (12.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"margin-top: 6px; font-size: 12.5px; color: rgb(100, 118, 138); border-left: 3px solid rgb(215, 223, 232); padding-left: 12px;\">Not an EHR or eMAR — CareBase runs the non-clinical operation around the chart, and routes medication events from your external source.</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(3) > div:nth-child(2) > div:nth-child(4)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 2.73,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#8a99a8",
+               "fontSize": "10.1pt (13.5px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section style=\"background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "section:nth-child(6)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"font-size: 13.5px; color: rgb(138, 153, 168); text-decoration: line-through;\">Sign-in sheets reconciled once a year</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "section:nth-child(6) > div > div > div:nth-child(1) > div:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 2.73,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#8a99a8",
+               "fontSize": "10.1pt (13.5px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section style=\"background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "section:nth-child(6)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"font-size: 13.5px; color: rgb(138, 153, 168); text-decoration: line-through;\">Binder night before the survey</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "section:nth-child(6) > div > div > div:nth-child(2) > div:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 2.73,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#8a99a8",
+               "fontSize": "10.1pt (13.5px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section style=\"background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "section:nth-child(6)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"font-size: 13.5px; color: rgb(138, 153, 168); text-decoration: line-through;\">Expirations discovered by the surveyor</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "section:nth-child(6) > div > div > div:nth-child(3) > div:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 2.73,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#8a99a8",
+               "fontSize": "10.1pt (13.5px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section style=\"background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "section:nth-child(6)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 2.73 (foreground color: #8a99a8, background color: #f6f8fa, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"font-size: 13.5px; color: rgb(138, 153, 168); text-decoration: line-through;\">Nine spreadsheets, one person who gets them</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "section:nth-child(6) > div > div > div:nth-child(4) > div:nth-child(1)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 4.38,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#64768a",
+               "fontSize": "9.8pt (13px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.8pt (13px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section id=\"start\" style=\"scroll-margin-top: 72px; background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "#start",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.8pt (13px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"font-size: 13px; color: rgb(100, 118, 138); margin-top: 6px;\">Stuck on something?<a href=\"/faq\">The FAQ</a> answers the common questions;<a href=\"mailto:hello@caremetric.ai\">hello@caremetric.ai</a> answers async — never a required call.</div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "#start > div > div:nth-child(1) > div:nth-child(5)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 4.38,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#64768a",
+               "fontSize": "9.8pt (13px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.8pt (13px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section id=\"start\" style=\"scroll-margin-top: 72px; background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "#start",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.8pt (13px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<a href=\"/faq\">The FAQ</a>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(5) > a[href$=\"faq\"]",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#f6f8fa",
+               "contrastRatio": 4.38,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#64768a",
+               "fontSize": "9.8pt (13px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.8pt (13px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<section id=\"start\" style=\"scroll-margin-top: 72px; background: rgb(246, 248, 250); border-bottom: 1px solid rgb(229, 234, 240);\">",
+                 "target": Array [
+                   "#start",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.38 (foreground color: #64768a, background color: #f6f8fa, font size: 9.8pt (13px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<a href=\"mailto:hello@caremetric.ai\">hello@caremetric.ai</a>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "a[href=\"mailto:hello@caremetric.ai\"]",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#ffffff",
+               "contrastRatio": 2.91,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#8a99a8",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 2.91 (foreground color: #8a99a8, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div style=\"background: rgb(255, 255, 255); border: 2px solid rgb(27, 111, 194); border-radius: 14px; padding: 28px; display: flex; flex-direction: column; gap: 16px; box-shadow: rgba(27, 111, 194, 0.12) 0px 16px 40px;\">",
+                 "target": Array [
+                   "#start > div > div:nth-child(2)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 2.91 (foreground color: #8a99a8, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<div style=\"font-size: 12px; color: rgb(138, 153, 168); text-align: center;\">Every module included · unlimited staff · cancel in-app, export everything ·<a href=\"/privacy\">Privacy</a></div>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "#start > div > div:nth-child(2) > div:nth-child(4)",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#ffffff",
+               "contrastRatio": 2.91,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#8a99a8",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 2.91 (foreground color: #8a99a8, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div style=\"background: rgb(255, 255, 255); border: 2px solid rgb(27, 111, 194); border-radius: 14px; padding: 28px; display: flex; flex-direction: column; gap: 16px; box-shadow: rgba(27, 111, 194, 0.12) 0px 16px 40px;\">",
+                 "target": Array [
+                   "#start > div > div:nth-child(2)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 2.91 (foreground color: #8a99a8, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<a href=\"/privacy\">Privacy</a>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "div:nth-child(4) > a[href$=\"privacy\"]",
+         ],
+       },
+     ],
+     "tags": Array [
+       "cat.color",
+       "wcag2aa",
+       "wcag143",
+       "TTv5",
+       "TT13.c",
+       "EN-301-549",
+       "EN-9.1.4.3",
+       "ACT",
+       "RGAAv4",
+       "RGAA-3.2.1",
+     ],
+   },
+ ]
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - link "Skip to content" [ref=e4] [cursor=pointer]:
      - /url: "#main"
    - banner [ref=e5]:
      - generic [ref=e6]:
        - link "CareMetric CareBase PCH & assisted living operations" [ref=e7] [cursor=pointer]:
          - /url: /
          - img [ref=e8]
          - generic [ref=e9]:
            - generic [ref=e10]: CareMetric CareBase
            - generic [ref=e11]: PCH & assisted living operations
        - navigation [ref=e12]:
          - link "Platform" [ref=e13] [cursor=pointer]:
            - /url: /#platform
          - link "How it works" [ref=e14] [cursor=pointer]:
            - /url: /how-it-works
          - link "Features" [ref=e15] [cursor=pointer]:
            - /url: /features
          - link "Pricing" [ref=e16] [cursor=pointer]:
            - /url: /#pricing
          - link "Savings" [ref=e17] [cursor=pointer]:
            - /url: /savings
          - link "Requirements" [ref=e18] [cursor=pointer]:
            - /url: /requirements
          - link "FAQ" [ref=e19] [cursor=pointer]:
            - /url: /faq
          - link "About" [ref=e20] [cursor=pointer]:
            - /url: /about
        - generic [ref=e21]:
          - link "Log in" [ref=e22] [cursor=pointer]:
            - /url: /login
          - link "Start free trial" [ref=e23] [cursor=pointer]:
            - /url: /signup
    - main [ref=e24]:
      - generic [ref=e25]:
        - generic [ref=e27]:
          - generic [ref=e28]:
            - generic [ref=e29]: Built for Pennsylvania PCH & ALF operators
            - heading "Run the facility. See the risk. Prove the work." [level=1] [ref=e31]:
              - generic [ref=e32]: Run the facility.
              - generic [ref=e33]: See the risk.
              - generic [ref=e34]: Prove the work.
            - paragraph [ref=e35]: Know you're survey-ready before the knock — without running your facility out of spreadsheets, binders, and one person's memory.
            - generic [ref=e36]:
              - link "Start a free trial" [ref=e37] [cursor=pointer]:
                - /url: "#pricing"
              - link "See how it works" [ref=e38] [cursor=pointer]:
                - /url: /how-it-works
            - generic [ref=e39]: Fully self-service — signup to first binder without a phone call. 14-day free trial.
          - generic [ref=e40]:
            - generic [ref=e41]:
              - generic [ref=e46]: CAREBASE / FACILITY COMMAND CENTER
              - generic [ref=e47]:
                - generic [ref=e48]:
                  - generic [ref=e49]: Sunrise Healthcare Group
                  - generic [ref=e50]: 4 facilities · 186 employees · binder ready
                - generic [ref=e51]: 94% compliant
              - generic [ref=e52]:
                - generic [ref=e54]:
                  - generic [ref=e55]: Annual in-service hours
                  - generic [ref=e56]: On track
                - generic [ref=e60]:
                  - generic [ref=e61]: Medication practicums
                  - generic [ref=e62]: Current
                - generic [ref=e65]:
                  - generic [ref=e66]:
                    - generic [ref=e67]: Expiring credentials
                    - generic [ref=e68]: 3 due in 21 days
                  - generic [ref=e71]: Act 34 clearance — J. Miller, R. Chen, T. Brooks · alert sent to facility manager
                - generic [ref=e73]:
                  - generic [ref=e74]: Resident assessments
                  - generic [ref=e75]: 5 due · scheduled
            - generic [ref=e78]:
              - generic [ref=e79]: Risk caught before survey day
              - generic [ref=e80]: Retraining assigned · due Aug 2 · evidence attached
        - generic [ref=e82]:
          - generic [ref=e83]:
            - generic [ref=e84]: 12–16 hrs
            - generic [ref=e85]: annual training tracked per direct care worker, by facility type
          - generic [ref=e86]:
            - generic [ref=e87]: Ch. 2600 + 2800
            - generic [ref=e88]: PA regulations crosswalked to the records that prove them
          - generic [ref=e89]:
            - generic [ref=e90]: 60+
            - generic [ref=e91]: survey-ready form templates included
          - generic [ref=e92]:
            - generic [ref=e93]: 1 record
            - generic [ref=e94]: every role — admin to auditor — works from the same evidence
      - generic [ref=e96]:
        - generic [ref=e97]:
          - generic [ref=e98]: In plain English
          - heading "One system that proves your facility is doing its job" [level=2] [ref=e99]
          - paragraph [ref=e100]: CareBase tracks every training hour, credential, clearance, resident assessment, incident, and inspection your Pennsylvania license requires — assigns the work to the right person before it's late, and turns the proof into a binder your surveyor can't argue with.
        - generic [ref=e101]:
          - generic [ref=e102]:
            - generic [ref=e103]: "01"
            - generic [ref=e104]: SURVEY READINESS
            - heading "Pass your next survey" [level=3] [ref=e105]
            - paragraph [ref=e106]: Every §2600 / §2800 requirement lives on its own clock with evidence attached as work happens. When the surveyor knocks, the binder is an export — not a lost weekend.
            - link "See how it works →" [ref=e107] [cursor=pointer]:
              - /url: /how-it-works
          - generic [ref=e108]:
            - generic [ref=e109]: "02"
            - generic [ref=e110]: EDUCATION SPEND
            - heading "Spend less on required education" [level=3] [ref=e111]
            - paragraph [ref=e112]: The course builder, AI course creation from your own policies, live QR classes, and certificates are built in — stop paying per-seat LMS fees and yearly content libraries for the same mandatory topics.
            - link "See where the money comes from →" [ref=e113] [cursor=pointer]:
              - /url: /savings
          - generic [ref=e114]:
            - generic [ref=e115]: "03"
            - generic [ref=e116]: YOUR TIME
            - heading "Get your evenings back" [level=3] [ref=e117]
            - paragraph [ref=e118]: The system nags, routes, escalates, and files so compliance stops living in one person's memory — and stops following you home in a tote bag of binders.
      - generic [ref=e120]:
        - heading "Which facility do you run?" [level=2] [ref=e121]
        - generic [ref=e122]:
          - generic [ref=e123]:
            - generic [ref=e124]: 55 PA. CODE CHAPTER 2600
            - heading "I run a personal care home" [level=3] [ref=e125]
            - paragraph [ref=e126]: Your surveyor wants 12 annual in-service hours per direct care worker (§2600.65, up to 6 on-the-job), current RASP assessments and support plans, medication practicums, Act 34 clearances, and fire drill logs — with proof for each.
            - paragraph [ref=e127]:
              - strong [ref=e128]: Your usual failure mode isn't missing training — it's the sign-in sheet nobody can find.
              - text: CareBase logs the hours as they happen and keeps the evidence attached.
            - generic [ref=e129]:
              - generic [ref=e130]: 12-hr buckets auto-applied
              - generic [ref=e131]: +6 hrs secured dementia unit
              - generic [ref=e132]: Ch. 2600 crosswalk
            - link "Set up your PCH in minutes →" [ref=e133] [cursor=pointer]:
              - /url: "#start"
          - generic [ref=e134]:
            - generic [ref=e135]: 55 PA. CODE CHAPTER 2800
            - heading "I run an assisted living facility" [level=3] [ref=e136]
            - paragraph [ref=e137]:
              - text: "You carry the heavier load: 16 annual hours per direct care worker (§2800.65), dementia training that"
              - emphasis [ref=e138]: doesn't
              - text: count toward the 16 (§2800.69), special-care-unit add-ons, and ASP assessments on their own clocks.
            - paragraph [ref=e139]:
              - strong [ref=e140]: The dementia-hours carve-out is where ALFs get cited.
              - text: CareBase tracks the buckets separately so nothing double-counts.
            - generic [ref=e141]:
              - generic [ref=e142]: 16-hr buckets auto-applied
              - generic [ref=e143]: Dementia hrs tracked separately
              - generic [ref=e144]: Ch. 2800 crosswalk
            - link "Set up your ALF in minutes →" [ref=e145] [cursor=pointer]:
              - /url: "#start"
        - paragraph [ref=e146]:
          - text: Group home, nursing, home health, or hospice? The
          - link "requirements guide" [ref=e147] [cursor=pointer]:
            - /url: /requirements
          - text: covers your pathway too.
      - generic [ref=e149]:
        - generic [ref=e150]:
          - generic [ref=e151]: The whole facility, one record
          - heading "Stop being the person who remembers everything" [level=2] [ref=e152]
          - paragraph [ref=e153]: Residents, staff, the building, and the survey — every deadline on its own clock, every task owned, every completion leaving proof. Pick a domain to see the actual workflow.
        - generic [ref=e154]:
          - button "Residents" [ref=e155] [cursor=pointer]
          - button "Workforce" [ref=e156] [cursor=pointer]
          - button "Facility & safety" [ref=e157] [cursor=pointer]
          - button "Survey evidence" [ref=e158] [cursor=pointer]
        - generic [ref=e159]:
          - generic [ref=e160]:
            - generic [ref=e161]:
              - generic [ref=e162]: Resident compliance — Maple Grove
              - generic [ref=e163]: Census 42 / 48 · 3 move-ins this month
            - generic [ref=e164]:
              - generic [ref=e165]: RESIDENT
              - generic [ref=e166]: ROOM
              - generic [ref=e167]: RASP STATUS
              - generic [ref=e168]: SUPPORT PLAN
              - generic [ref=e169]: M. Alvarez
              - generic [ref=e170]: "12"
              - generic [ref=e171]: Current
              - generic [ref=e172]: Updated May 2
              - generic [ref=e173]: J. Okafor
              - generic [ref=e174]: "07"
              - generic [ref=e175]: Annual due · 14d
              - generic [ref=e176]: Review opened
              - generic [ref=e177]: R. Santos
              - generic [ref=e178]: "21"
              - generic [ref=e179]: Overdue · 3d
              - generic [ref=e180]: Reassess first
              - generic [ref=e181]: E. Werner
              - generic [ref=e182]: "09"
              - generic [ref=e183]: Current
              - generic [ref=e184]: Updated Jun 10
            - generic [ref=e185]: Completing a reassessment auto-opens the support-plan update it requires — §2600.225/.227 tracked per resident.
          - generic [ref=e186]:
            - heading "From inquiry to discharge" [level=3] [ref=e187]
            - paragraph [ref=e188]: Resident-level compliance and the daily work around it — each item on its own due-date clock.
            - generic [ref=e189]:
              - generic [ref=e190]: Admissions & census
              - generic [ref=e191]: RASP / ASP assessments
              - generic [ref=e192]: Support-plan triggers
              - generic [ref=e193]: Resident services & refusals
              - generic [ref=e194]: Change-of-condition follow-up
              - generic [ref=e195]: Dietary & food safety rounds
              - generic [ref=e196]: Appointments & transport
              - generic [ref=e197]: Resident finance subledger
            - generic [ref=e198]: Not an EHR or eMAR — CareBase runs the non-clinical operation around the chart, and routes medication events from your external source.
      - generic [ref=e200]:
        - heading "Facilities don't fail surveys for lack of training. They fail to find the proof." [level=2] [ref=e201]:
          - text: Facilities don't fail surveys for lack of training.
          - text: They fail to find the proof.
        - generic [ref=e202]:
          - generic [ref=e203]:
            - generic [ref=e204]: Sign-in sheets reconciled once a year
            - generic [ref=e205]: Hours logged as training happens
          - generic [ref=e206]:
            - generic [ref=e207]: Binder night before the survey
            - generic [ref=e208]: Binder PDF generated from live records
          - generic [ref=e209]:
            - generic [ref=e210]: Expirations discovered by the surveyor
            - generic [ref=e211]: Alerts escalate before anything lapses
          - generic [ref=e212]:
            - generic [ref=e213]: Nine spreadsheets, one person who gets them
            - generic [ref=e214]: One record every role works from
      - generic [ref=e216]:
        - generic [ref=e217]:
          - generic [ref=e218]: What sets it apart
          - heading "Four things you won't find in a training portal" [level=2] [ref=e219]
        - generic [ref=e220]:
          - generic [ref=e221]:
            - heading "AI course creation with a human gate" [level=3] [ref=e222]
            - paragraph [ref=e223]: Paste a regulation, policy, or reference document and CareBase drafts the complete course — modules, lesson text or video scripts, and graded quizzes — grounded strictly in your source. It flags gaps instead of inventing citations.
            - paragraph [ref=e224]: Add an AI avatar presenter video if you want one. Nothing publishes until a named reviewer signs off — and the sign-off clears automatically the moment any block is regenerated.
            - generic [ref=e225]: REVIEWED BY A REAL PERSON, EVERY TIME
          - generic [ref=e226]:
            - heading "Citation-weighted readiness score" [level=3] [ref=e227]
            - paragraph [ref=e228]: A live, per-facility score weighted by how often DHS actually cites each regulation — not a generic checklist percentage.
            - paragraph [ref=e229]: Training, credentials, background checks, inspections, incidents, and policy attestations roll into one number, sorted so your most-citable exposure surfaces first.
            - generic [ref=e230]: SEE WHAT THE SURVEYOR WILL FLAG, FIRST
          - generic [ref=e231]:
            - heading "Live pass-meds authorization roster" [level=3] [ref=e232]
            - paragraph [ref=e233]:
              - text: "The question a surveyor asks on-site: who is authorized to administer medications"
              - emphasis [ref=e234]: right now
              - text: "?"
            - paragraph [ref=e235]: One roster cross-checks each employee's medication-administration certification, current-year practicum, and insulin authorization into a single yes or no.
            - generic [ref=e236]: ONE ANSWER PER EMPLOYEE, ALWAYS CURRENT
          - generic [ref=e237]:
            - heading "Paperless live-class attendance" [level=3] [ref=e238]
            - paragraph [ref=e239]: Each class shows a QR code that rotates every 30 seconds — staff scan with their own phones, or a shared kiosk takes name and PIN. No app installs.
            - paragraph [ref=e240]: A printable meeting notice with an embedded QR and a backup paper table covers anyone who can't scan; upload the completed sheet back into the class record.
            - generic [ref=e241]: HOURS COUNT THE MOMENT THEY SIGN IN
      - generic [ref=e243]:
        - generic [ref=e244]:
          - generic [ref=e245]: Seen enough to be curious?
          - generic [ref=e246]: Import your roster this afternoon — the trial is self-serve and every module is included.
        - generic [ref=e247]:
          - link "Start free trial" [ref=e248] [cursor=pointer]:
            - /url: "#pricing"
          - link "See all 50+ capabilities" [ref=e249] [cursor=pointer]:
            - /url: /features
      - generic [ref=e251]:
        - generic [ref=e252]:
          - generic [ref=e253]: Pricing
          - heading "Priced per facility. Every module included." [level=2] [ref=e254]
          - paragraph [ref=e255]: No per-seat math, no module upsells. Unlimited employees and residents on every plan.
        - generic [ref=e256]:
          - generic [ref=e257]:
            - generic [ref=e258]: Single facility
            - generic [ref=e259]: $349 / facility / month
            - generic [ref=e260]:
              - generic [ref=e261]:
                - generic [ref=e262]: ✓
                - text: All modules — residents, workforce, facility, evidence
              - generic [ref=e263]:
                - generic [ref=e264]: ✓
                - text: Unlimited employees & residents
              - generic [ref=e265]:
                - generic [ref=e266]: ✓
                - text: Email + SMS alerts, binder exports
              - generic [ref=e267]:
                - generic [ref=e268]: ✓
                - text: Self-serve setup, CSV roster import
            - link "Start 14-day free trial" [ref=e269] [cursor=pointer]:
              - /url: "#start"
          - generic [ref=e270]:
            - generic [ref=e271]: MULTI-SITE
            - generic [ref=e272]: Organization · 3+ facilities
            - generic [ref=e273]: $299 / facility / month
            - generic [ref=e274]:
              - generic [ref=e275]:
                - generic [ref=e276]: ✓
                - text: Everything in Single facility
              - generic [ref=e277]:
                - generic [ref=e278]: ✓
                - text: Org-wide rollups & facility comparisons
              - generic [ref=e279]:
                - generic [ref=e280]: ✓
                - text: Cross-facility float staff scheduling
              - generic [ref=e281]:
                - generic [ref=e282]: ✓
                - text: Controlled evidence rooms for auditors
            - link "Start 14-day free trial" [ref=e283] [cursor=pointer]:
              - /url: "#start"
          - generic [ref=e284]:
            - generic [ref=e285]: Enterprise & groups
            - generic [ref=e286]: Custom
            - generic [ref=e287]:
              - generic [ref=e288]:
                - generic [ref=e289]: ✓
                - text: Volume pricing across 10+ facilities
              - generic [ref=e290]:
                - generic [ref=e291]: ✓
                - text: Guided migration & onboarding
              - generic [ref=e292]:
                - generic [ref=e293]: ✓
                - text: Contract, hosting & security review
              - generic [ref=e294]:
                - generic [ref=e295]: ✓
                - text: Priority support
            - link "Talk to us" [ref=e296] [cursor=pointer]:
              - /url: "#start"
        - paragraph [ref=e297]:
          - text: These prices feed the
          - link "savings worksheet below" [ref=e298] [cursor=pointer]:
            - /url: /savings
            - strong [ref=e299]: savings worksheet below
          - text: automatically — model your net opportunity with your own coordination hours and tool spend, risk avoidance excluded.
      - generic [ref=e301]:
        - generic [ref=e302]: No guaranteed survey outcomes
        - generic [ref=e303]: ·
        - generic [ref=e304]: No per-seat fees
        - generic [ref=e305]: ·
        - generic [ref=e306]: Your data exports if you leave
        - link "Read our promises →" [ref=e307] [cursor=pointer]:
          - /url: /how-it-works#promises
      - generic [ref=e309]:
        - generic [ref=e310]:
          - generic [ref=e311]: Fully self-service
          - heading "Signup to survey-ready, without talking to anyone" [level=2] [ref=e312]
          - paragraph [ref=e313]: No sales call. No onboarding call. No "book time with our team." Every module is live the moment your organization exists.
          - generic [ref=e314]:
            - generic [ref=e315]:
              - generic [ref=e316]: "1"
              - generic [ref=e317]:
                - strong [ref=e318]: Create your organization
                - text: — name, facility type, admin email. About two minutes.
            - generic [ref=e319]:
              - generic [ref=e320]: "2"
              - generic [ref=e321]:
                - strong [ref=e322]: Import your roster
                - text: — one CSV brings every employee in; add facilities as you go.
            - generic [ref=e323]:
              - generic [ref=e324]: "3"
              - generic [ref=e325]:
                - strong [ref=e326]: Requirements apply themselves
                - text: — hour buckets, renewal windows, and alerts start from your facility type and each person's role.
            - generic [ref=e327]:
              - generic [ref=e328]: "4"
              - generic [ref=e329]:
                - strong [ref=e330]: Export your first binder
                - text: — see your real compliance picture the same day.
          - generic [ref=e331]:
            - text: Stuck on something?
            - link "The FAQ" [ref=e332] [cursor=pointer]:
              - /url: /faq
            - text: answers the common questions;
            - link "hello@caremetric.ai" [ref=e333] [cursor=pointer]:
              - /url: mailto:hello@caremetric.ai
            - text: answers async — never a required call.
        - generic [ref=e334]:
          - generic [ref=e335]: START NOW — ALL YOU NEED
          - generic [ref=e336]:
            - generic [ref=e337]:
              - generic [ref=e338]: ✓
              - text: Your facility name and license type
            - generic [ref=e339]:
              - generic [ref=e340]: ✓
              - text: A work email for the admin account
            - generic [ref=e341]:
              - generic [ref=e342]: ✓
              - text: "Optional: a roster CSV for bulk import"
          - link "Create your organization — free for 14 days" [ref=e343] [cursor=pointer]:
            - /url: /signup
          - generic [ref=e344]:
            - text: Every module included · unlimited staff · cancel in-app, export everything ·
            - link "Privacy" [ref=e345] [cursor=pointer]:
              - /url: /privacy
      - generic [ref=e347]:
        - heading "Straight answers" [level=2] [ref=e348]
        - generic [ref=e349]:
          - generic [ref=e350]:
            - generic [ref=e351]: What is CareBase?
            - paragraph [ref=e352]: The operations, workforce-compliance, and survey-readiness platform for Pennsylvania personal care homes and assisted living facilities. Not an EHR or eMAR.
          - generic [ref=e353]:
            - generic [ref=e354]: How much does it cost?
            - paragraph [ref=e355]:
              - text: From $299/facility/month for multi-site organizations, $349 for a single facility — every module, unlimited staff.
              - link "See pricing." [ref=e356] [cursor=pointer]:
                - /url: "#pricing"
          - generic [ref=e357]:
            - generic [ref=e358]: What does it replace — and not replace?
            - paragraph [ref=e359]: Replaces training spreadsheets, paper binders, point trackers, and basic scheduling. Works alongside — never replaces — your eMAR, EHR, payroll, HRIS, and accounting.
          - generic [ref=e360]:
            - generic [ref=e361]: Can a surveyor or auditor get access?
            - paragraph [ref=e362]: Yes — a read-only auditor role, plus time-limited evidence rooms scoped to exactly what was requested.
          - generic [ref=e363]:
            - generic [ref=e364]: How fast can we start?
            - paragraph [ref=e365]: Same day. Self-serve signup creates your organization; CSV import onboards a full roster in minutes.
        - paragraph [ref=e366]:
          - link "Read the full FAQ — 20+ answers →" [ref=e367] [cursor=pointer]:
            - /url: /faq
    - contentinfo [ref=e368]:
      - generic [ref=e369]:
        - generic [ref=e370]: © 2026 CareMetric CareBase. All rights reserved.
        - generic [ref=e371]:
          - link "Home" [ref=e372] [cursor=pointer]:
            - /url: /
          - link "How it works" [ref=e373] [cursor=pointer]:
            - /url: /how-it-works
          - link "Features" [ref=e374] [cursor=pointer]:
            - /url: /features
          - link "Savings" [ref=e375] [cursor=pointer]:
            - /url: /savings
          - link "Requirements" [ref=e376] [cursor=pointer]:
            - /url: /requirements
          - link "FAQ" [ref=e377] [cursor=pointer]:
            - /url: /faq
          - link "About" [ref=e378] [cursor=pointer]:
            - /url: /about
          - link "Security" [ref=e379] [cursor=pointer]:
            - /url: /security
          - link "Privacy" [ref=e380] [cursor=pointer]:
            - /url: /privacy
          - link "Terms" [ref=e381] [cursor=pointer]:
            - /url: /terms
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import AxeBuilder from "@axe-core/playwright";
  3  | 
  4  | test.describe("public release smoke journeys", () => {
  5  |   test("landing page exposes the primary conversion and sign-in paths", async ({ page }) => {
  6  |     await page.goto("/");
  7  | 
  8  |     await expect(page.getByRole("heading", {
  9  |       level: 1,
  10 |       name: "Run the facility. See the risk. Prove the work.",
  11 |     })).toBeVisible();
  12 |     await expect(page.getByRole("link", { name: "Start free trial", exact: true }).first()).toHaveAttribute("href", "/signup");
  13 |     await expect(page.getByRole("link", { name: "Log in", exact: true }).first()).toHaveAttribute("href", "/login");
  14 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  15 | 
  16 |     const results = await new AxeBuilder({ page }).analyze();
> 17 |     expect(results.violations).toEqual([]);
     |                                ^ Error: expect(received).toEqual(expected) // deep equality
  18 |   });
  19 | 
  20 |   test("landing page offers the self-serve signup path", async ({ page }) => {
  21 |     await page.goto("/");
  22 | 
  23 |     await expect(
  24 |       page.getByRole("link", { name: /create your organization/i }),
  25 |     ).toHaveAttribute("href", "/signup");
  26 |   });
  27 | });
  28 | 
```