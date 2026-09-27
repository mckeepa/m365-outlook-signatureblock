export interface ComposeBody {
  setSignatureAsync(
    signatureHtml: string,
    callback: (result: { succeeded: boolean }) => void,
  ): void;
}

export function applySignature(
  body: ComposeBody,
  signatureHtml: string,
  complete: (succeeded: boolean) => void,
): void {
  let completed = false;
  const finish = (succeeded: boolean) => {
    if (completed) return;
    completed = true;
    complete(succeeded);
  };

  try {
    body.setSignatureAsync(
      signatureHtml,
      (result) => finish(result.succeeded),
    );
  } catch {
    finish(false);
  }
}
