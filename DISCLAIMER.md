# Disclaimer

**EchoFox is not affiliated with, endorsed by, or in any way officially connected to WhatsApp Inc., Meta Platforms Inc., or any of their subsidiaries or affiliates.**

The official WhatsApp website is [whatsapp.com](https://whatsapp.com). "WhatsApp" and all related names, marks, emblems, and images are registered trademarks of their respective owners.

---

## ⚠️ Read This Before Using EchoFox

EchoFox is built on top of [Baileys](https://github.com/WhiskeySockets/Baileys), a reverse-engineered WhatsApp Web client. Using it carries real risks that you accept by running this software.

### 1. WhatsApp Terms of Service

Automated use of WhatsApp — including via Baileys-based bots like EchoFox — **may violate** the [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service) and the [WhatsApp Business Terms of Service](https://www.whatsapp.com/legal/business-terms). WhatsApp explicitly prohibits:

- Unauthorized automated or bulk messaging
- Scraping data from WhatsApp without permission
- Using non-official WhatsApp clients for messaging at scale

You are solely responsible for understanding and complying with WhatsApp's terms in your jurisdiction.

### 2. Account Ban Risk

WhatsApp actively detects and bans accounts behaving in non-human patterns. Likely triggers include:

- High message send rates
- Messaging people who have never contacted you first
- Joining many groups in short succession
- Repetitive content patterns
- Using a brand-new number without a "warm-up" period

**Your WhatsApp number can and may be permanently banned.** EchoFox includes mitigations (rate limiting, send queue, human-like delays), but these reduce — they do not eliminate — the risk. Use a number you can afford to lose.

### 3. No Spam, No Stalking, No Harassment

The EchoFox maintainers explicitly **do not condone** the use of this software for:

- Unsolicited bulk messaging (spam)
- Stalkerware or surveillance of any person without their explicit, informed consent
- Harassment, threats, or any unlawful conduct
- Circumventing blocks, restraining orders, or platform safety measures

Using EchoFox for any of the above is a violation of these terms and may also be a criminal offense in your jurisdiction.

### 4. No Warranty

EchoFox is provided "AS IS" under the [GNU Affero General Public License v3.0](./LICENSE), without warranty of any kind, express or implied. The maintainers and contributors disclaim all liability for any damages arising from the use of this software, including but not limited to:

- Loss of WhatsApp account access
- Loss of data
- Service interruption
- Any direct, indirect, incidental, or consequential damages

### 5. Commercial Use

The AGPL-3.0 license permits commercial use, **but**:

- WhatsApp's Terms of Service may prohibit commercial automated messaging on consumer WhatsApp.
- For legitimate business messaging, use the official [WhatsApp Business API](https://business.whatsapp.com/products/business-platform) instead.
- Any commercial deployment must also comply with the AGPL-3.0 source-disclosure requirements (you must offer source code to users who interact with the bot over a network).

### 6. Data & Privacy

EchoFox stores message metadata and content locally (SQLite by default, or Postgres/MongoDB/Redis if configured) to satisfy WhatsApp's retry/decryption requirements. If you operate EchoFox for users other than yourself, **you become a data controller** under applicable privacy laws (GDPR, CCPA, India DPDP Act, etc.) and must:

- Inform users that their messages are being processed
- Provide a privacy policy
- Honor data-access and deletion requests
- Implement appropriate security measures

EchoFox does **not** phone home, send telemetry, or transmit any data to the maintainers in v1.x.

---

## By using EchoFox you affirm that:

- [ ] You have read and understood this disclaimer in full
- [ ] You accept the risk of WhatsApp account loss
- [ ] You will not use EchoFox for spam, harassment, stalking, or any unlawful purpose
- [ ] You will comply with applicable laws in your jurisdiction
- [ ] You release the maintainers and contributors from all liability

If you cannot agree to all of the above, **do not use this software**.

---

*Last updated: 2026-05-29*
