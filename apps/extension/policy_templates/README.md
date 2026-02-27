# Iron Gate Chrome Enterprise Policy Deployment

## Google Admin Console

1. Go to **Devices > Chrome > Apps & extensions > Users & browsers**
2. Click the **+** icon and select **Add Chrome app or extension by ID**
3. Enter the Iron Gate extension ID
4. Set **Installation Policy** to "Force install"
5. Under **Policy for extensions**, paste the contents of `chrome_enterprise.json`
6. Replace `YOUR_EXTENSION_ID` with the actual extension ID
7. Set `apiKey` and `firmId` to your firm's values

## Windows Group Policy

1. Download the Chrome ADMX templates from Google
2. Open Group Policy Editor (gpedit.msc)
3. Navigate to `Computer Configuration > Administrative Templates > Google Chrome > Extensions`
4. Enable "Configure the list of force-installed apps and extensions"
5. Add: `YOUR_EXTENSION_ID;https://clients2.google.com/service/update2/crx`
6. For managed storage, set the registry key:
   ```
   HKLM\SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\YOUR_EXTENSION_ID\policy
   ```

## Jamf (Mac MDM)

1. Create a new Configuration Profile
2. Add a Custom Settings payload
3. Set the preference domain to `com.google.Chrome.extensions.YOUR_EXTENSION_ID`
4. Add the policy keys from `chrome_enterprise.json`

## Managed Storage Schema

The extension's `managed_schema.json` defines these configurable properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `apiKey` | string | Yes | Firm API key |
| `firmId` | string | Yes | Firm identifier |
| `defaultMode` | enum | No | `audit` or `proxy` (default: `audit`) |
| `apiBaseUrl` | string | No | API URL (default: production) |
