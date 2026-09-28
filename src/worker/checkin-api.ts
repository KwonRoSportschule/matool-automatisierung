import { AppError } from "../core/app-error";
import { jsonResponse, methodNotAllowed } from "../core/http";
import {
  ladeBeitragsStichtag,
  listeBeitragsStichtage
} from "./beitrags-archiv";
import {
  berlinerDatum,
  beitragsStichtag,
  checkinBeitragsAntwort,
  erstelleAktuelleBeitragsUebersicht
} from "./beitraege";
import type { Env } from "./env";
import { requireCheckinServiceRequest } from "./integration-auth";

/**
 * Schnittstelle fuer die Klassenauswertung (Check-in-/Telemetrieseite).
 *
 * Nur lesend und nur die Beitragsuebersicht. Der Zugang laeuft ueber einen
 * eigenen Bearer-Token (CHECKIN_SERVICE_TOKEN), unabhaengig von Zapier und
 * vom Dashboard-Passwort.
 *
 * - GET /api/checkin/v1/beitraege?stichtag=JJJJ-MM-TT
 *     heute: live aus dem aktuellen Bestand; frueher: gesicherter Stand
 *     (nur der 1. und 15. eines Monats werden gesichert)
 * - GET /api/checkin/v1/beitraege/stichtage
 *     alle gesicherten Stichtage mit Kennzahlen (ohne Personen), neueste
 *     zuerst, inklusive Summen je Einzugstag (1 bis 31)
 */
export async function handleCheckinApiRequest(
  request: Request,
  url: URL,
  env: Env,
  jetzt: Date = new Date()
): Promise<Response> {
  requireCheckinServiceRequest(request, env);
  if (request.method !== "GET") {
    methodNotAllowed(["GET"]);
  }

  const heute = berlinerDatum(jetzt);

  if (url.pathname === "/api/checkin/v1/beitraege") {
    const stichtag = beitragsStichtag(url, jetzt);
    if (stichtag > heute) {
      throw new AppError(
        "beitraege_stichtag_in_zukunft",
        400,
        "Fuer einen Stichtag in der Zukunft gibt es noch keinen Stand."
      );
    }

    if (stichtag === heute) {
      const { feldwerte, uebersicht } = await erstelleAktuelleBeitragsUebersicht(
        env,
        stichtag,
        jetzt
      );
      return jsonResponse(checkinBeitragsAntwort(uebersicht, feldwerte, "live"));
    }

    const gesichert = await ladeBeitragsStichtag(env, stichtag);
    if (!gesichert) {
      throw new AppError(
        "beitraege_stichtag_nicht_gesichert",
        404,
        "Fuer diesen Tag wurde kein Stand der Beitragsuebersicht gesichert."
      );
    }
    return jsonResponse(
      checkinBeitragsAntwort(gesichert.uebersicht, gesichert.feldwerte, "archiv")
    );
  }

  if (url.pathname === "/api/checkin/v1/beitraege/stichtage") {
    const stichtage = await listeBeitragsStichtage(env);
    return jsonResponse({
      schema_version: 1,
      heute,
      stichtage: stichtage.map((eintrag) => ({
        stichtag: eintrag.stichtag,
        erstellt_am: eintrag.erstelltAm,
        vollstaendig: eintrag.vollstaendig,
        monatssumme_cent: eintrag.monatssummeCent,
        mitglieder_gesamt: eintrag.mitgliederGesamt,
        mit_beitrag: eintrag.mitBeitrag,
        ohne_beitrag: eintrag.ohneBeitrag,
        stillgelegt: eintrag.stillgelegt,
        ex_mitglieder: eintrag.exMitglieder,
        einzug_nach_tag: eintrag.einzugNachTag,
        einzug_unklar: eintrag.einzugUnklar
      }))
    });
  }

  throw new AppError(
    "route_not_found",
    404,
    "Die angeforderte API-Route existiert nicht."
  );
}
