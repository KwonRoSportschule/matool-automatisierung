import { describe, expect, it } from "vitest";

import { MatoolClient } from "../src/matool/client";

/**
 * Nachbau der MATOOL-Mitgliedsmaske aus einer echten Aufzeichnung.
 * Enthaelt bewusst auch Listenfilter, die nicht uebernommen werden duerfen.
 */
function schuelerSeite(sourceId: string): string {
  return `
    <html><body>
      <form name="suche"><input name="suche_set" value="PRIVATE-FILTER"></form>
      <form>
        <input type="hidden" name="todo" value="2">
        <input type="hidden" name="schueler_nr" value="${sourceId}">
        <input type="hidden" name="session_insert_id" value="885269406">
        <input name="vname" value="Natalia">
        <input name="name" value="Gambardella">
        <input name="strasse" value="Haidenholzstr. 30">
        <input name="plz" value="83071">
        <input name="stadt" value="Stephanskirchen">
        <input name="telefon" value="08036 3014129">
        <input name="handy" value="0172 4021244">
        <input name="email" value="ganat@freenet.de">
        <input name="geburtstag" value="14.09.1972">
        <input name="kundenart" value="Vertragskunde">
        <input name="vertrag" value="#*_12-M TKD">
        <input name="vertragsbeginn" value="01.08.2015">
        <input name="vertragsende" value="31.07.2016">
        <input name="beitrag" value="60,00">
        <input name="jahresgebuehr" value="30,00">
        <input name="bank" value="Netbank">
        <input name="iban" value="DE66 5001 0517 5423 0283 50">
        <input name="bic" value="INGDDEFFXXX">
        <input name="mandatsreferenz" value="RO0010">
        <input name="kontoinhaber" value="Gambardella Natalia">
        <input name="schule" value="273">
        <input name="barcode" value="1000000013504">
        <input type="password" name="pass" value="GEHEIM">
        <select name="zahlart">
          <option value="Bar">Bar</option>
          <option value="Lastschrift" selected>Lastschrift</option>
        </select>
      </form>
    </body></html>
  `;
}

function clientFuerMitglied(
  sourceId: string,
  aufrufe: Array<{ body: string; url: string }>
): MatoolClient {
  return new MatoolClient(
    "https://core.matool.de",
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body =
        init?.body instanceof URLSearchParams ? init.body.toString() : "";
      aufrufe.push({ body, url });

      if (url.endsWith("/index.php") && init?.method === "POST") {
        return new Response(null, {
          headers: { Location: "/index.php" },
          status: 302
        });
      }
      if (url.includes("session_schueler_open.php")) {
        return new Response("", { status: 200 });
      }
      if (url.includes("show=schueler")) {
        return new Response(schuelerSeite(sourceId), {
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
}

describe("MATOOL-Mitglieder-Stammdaten", () => {
  it("liest die Mitgliedsmaske inklusive Bankdaten", async () => {
    const aufrufe: Array<{ body: string; url: string }> = [];
    const client = clientFuerMitglied("29345", aufrufe);

    const result = await client.extractSchuelerDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      ["29345"]
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.sourceId).toBe("29345");
    expect(result.records[0]?.payload).toMatchObject({
      bank: "Netbank",
      barcode: "1000000013504",
      beitrag: "60,00",
      bic: "INGDDEFFXXX",
      email: "ganat@freenet.de",
      geburtstag: "14.09.1972",
      iban: "DE66 5001 0517 5423 0283 50",
      id: "29345",
      kontoinhaber: "Gambardella Natalia",
      kundenart: "Vertragskunde",
      mandatsreferenz: "RO0010",
      name: "Gambardella",
      stadt: "Stephanskirchen",
      strasse: "Haidenholzstr. 30",
      vertrag: "#*_12-M TKD",
      vname: "Natalia",
      zahlart: "Lastschrift"
    });
  });

  it("uebernimmt weder Listenfilter noch Steuer- oder Passwortfelder", async () => {
    const aufrufe: Array<{ body: string; url: string }> = [];
    const client = clientFuerMitglied("29345", aufrufe);

    const result = await client.extractSchuelerDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      ["29345"]
    );

    const serialisiert = JSON.stringify(result);
    for (const verboten of [
      "PRIVATE-FILTER",
      "GEHEIM",
      "885269406",
      "suche_set",
      "session_insert_id"
    ]) {
      expect(serialisiert).not.toContain(verboten);
    }
  });

  it("oeffnet und schliesst den Datensatz und schreibt nichts zurueck", async () => {
    const aufrufe: Array<{ body: string; url: string }> = [];
    const client = clientFuerMitglied("29345", aufrufe);

    await client.extractSchuelerDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      ["29345"]
    );

    const sitzung = aufrufe.filter((a) =>
      a.url.includes("session_schueler_open.php")
    );
    expect(sitzung.map((a) => a.body)).toEqual([
      "schueler_open=29345&todo=open",
      "schueler_open=29345&todo=close"
    ]);

    // Das Speichern-Formular darf niemals hinausgehen.
    expect(aufrufe.filter((a) => a.body.includes("todo=2"))).toEqual([]);
  });
});
