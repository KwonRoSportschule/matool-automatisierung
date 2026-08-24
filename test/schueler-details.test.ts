import { describe, expect, it } from "vitest";

import { MatoolClient } from "../src/matool/client";

describe("MATOOL-Mitglieder-Stammdaten", () => {
  it("liest alle einfachen Felder inklusive Bankdaten und sendet todo leer", async () => {
    const calls: Array<{ body: string; url: string }> = [];
    const detail = {
      anrede: "Weiblich",
      bic: "INGDDEFFXXX",
      beitrag: "60,00",
      dokumente: [{ name: "PRIVATE-DOKUMENT" }],
      email: "ganat@freenet.de",
      geburtstag: "14.09.1972",
      historie: [{ eintrag: "PRIVATE-HISTORIE" }],
      iban: "DE66 5001 0517 5423 0283 50",
      id: "29345",
      kontoinhaber: "Gambardella Natalia",
      mandatsref: "ROO010",
      name: "Gambardella",
      vertrag: "12-M TKD",
      vorname: "Natalia",
      zahlungsart: "Lastschrift"
    };

    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body =
          init?.body instanceof URLSearchParams ? init.body.toString() : "";
        calls.push({ body, url });
        if (url.endsWith("/index.php") && init?.method === "POST") {
          return new Response(null, {
            headers: { Location: "/index.php" },
            status: 302
          });
        }
        if (url.includes("schueler_daten.php")) {
          return new Response(JSON.stringify([detail]), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
            status: 200
          });
        }
        return new Response("<html><body>Angemeldet</body></html>", {
          headers: { "Content-Type": "text/html" },
          status: 200
        });
      }) as typeof fetch
    );

    const result = await client.extractSchuelerDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      ["29345"]
    );

    expect(result.records).toHaveLength(1);
    const payload = result.records[0]?.payload ?? {};
    expect(payload).toMatchObject({
      beitrag: "60,00",
      bic: "INGDDEFFXXX",
      iban: "DE66 5001 0517 5423 0283 50",
      id: "29345",
      kontoinhaber: "Gambardella Natalia",
      vertrag: "12-M TKD",
      zahlungsart: "Lastschrift"
    });

    // Verschachtelte Listen werden nicht uebernommen.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("PRIVATE-DOKUMENT");
    expect(serialized).not.toContain("PRIVATE-HISTORIE");

    // Der Steuerparameter todo ist leer - so macht es MATOOL selbst.
    const detailCall = calls.find((call) =>
      call.url.includes("schueler_daten.php")
    );
    expect(detailCall?.body).toBe("id=29345&todo=");
  });
});
