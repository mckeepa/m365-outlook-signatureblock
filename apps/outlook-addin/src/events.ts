import type { SignatureProfile, SignatureTemplate } from "@signature/signature-core";
import { renderSignature } from "@signature/signature-core";
import { applySignature } from "./applySignature.js";

const pilotTemplate: SignatureTemplate = {
  id: "outlook-addin-poc",
  name: "Outlook add-in proof of concept",
  version: 1,
  isDefault: true,
  html: "<p>Regards,</p><p><strong>{{displayName}}</strong><br>{{jobTitle}}<br>{{email}}</p><p><em>TEST ONLY — Outlook add-in proof of concept</em></p>",
};

const pilotProfile: SignatureProfile = {
  displayName: "Pilot User",
  mail: "pilot@example.com",
  jobTitle: "Outlook add-in proof of concept",
};

function onNewMessageCompose(event: Office.MailboxEvent): void {
  const body = Office.context.mailbox.item?.body;
  if (!body) {
    event.completed();
    return;
  }

  const signatureHtml = renderSignature(pilotTemplate, pilotProfile);
  applySignature(
    {
      setSignatureAsync(html, callback) {
        body.setSignatureAsync(
          html,
          { coercionType: Office.CoercionType.Html },
          (result) => callback({ succeeded: result.status === Office.AsyncResultStatus.Succeeded }),
        );
      },
    },
    signatureHtml,
    (succeeded) => {
      if (!succeeded) {
        console.error("Signature Studio POC could not apply the test signature.");
      }
      event.completed();
    },
  );
}

Office.actions.associate("onNewMessageComposeHandler", onNewMessageCompose);
