# Master data workbook import

The Import tab uses the full SLH master-data Excel workbook, not CSV.

The web page accepts `.xlsx` and `.xls` files and sends the selected workbook as multipart `FormData` field `file` to the API:

- `POST /api/v1/master-data/workbook/preview`
- `POST /api/v1/master-data/workbook/commit`

The browser does not parse or flatten the workbook. The API reads each sheet and writes updates to the correct TMS master-data area:

- Sites
- Site Cutoffs
- Run Times
- Vehicles & Fuel
- Drivers
- Customer Contacts
- Market Contacts
- Fuel Price History

Drivers remain update-only; TachoMaster remains the authority for driver identity.