"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { type LatLng, PinMap } from "@/components/pin-map";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { ManagedPage, ShopLocationType } from "@/lib/page-tools";
import { cn } from "@/lib/utils";

import { findAddress, saveLocation } from "./actions";
import { SaveBar } from "./save-bar";
import { Block, Hint, Notice } from "./section-shell";

/** Metro areas have no outline: a pin this far from every park in the shop's metro area counts as outside it. */
const WRONG_CITY_KM = 40;

const TYPES: { value: ShopLocationType; label: string }[] = [
  { value: "storefront", label: "Storefront" },
  { value: "by_appointment", label: "By appointment" },
  { value: "online_only", label: "Online only" },
];

/**
 * Location (mockup: Web · page location): how people visit (shops), the
 * address as the team writes it, and the pin. Find on the map looks the
 * address up through our own server (Nominatim); then the map is dragged to
 * put the pin on the door. Use my location asks the browser. The city
 * (metro area) is Rachel's to set, with an amber warning when the pin lands
 * outside it. Organizers have the same address and pin, as their base.
 */
export function LocationSection({ page, metroParks }: { page: ManagedPage; metroParks: LatLng[] }) {
  const router = useRouter();
  const shop = page.roles.includes("shop");
  const startType: ShopLocationType = page.locationType ?? "storefront";

  const [type, setType] = useState<ShopLocationType>(startType);
  const [showPin, setShowPin] = useState(page.showPin);
  const [address, setAddress] = useState(page.address ?? "");
  const [pin, setPin] = useState<LatLng | null>(page.pin);
  const [found, setFound] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const online = shop && type === "online_only";
  const pinMoved = !samePin(pin, page.pin);
  const changes = [
    ...(shop && type !== startType ? ["how people visit"] : []),
    ...(shop && type === "by_appointment" && showPin !== page.showPin ? ["show the pin"] : []),
    ...(!online && address.trim() !== (page.address ?? "").trim() ? ["address"] : []),
    ...(!online && pinMoved ? [page.pin ? "pin moved" : pin ? "pin added" : "pin removed"] : []),
  ];

  const outside = !online && pin && page.metro && metroParks.length > 0 && nearestKm(pin, metroParks) > WRONG_CITY_KM;
  // Before there's a pin, the map waits on the city's parks (or isn't drawn at all).
  const mapCentre = pin ?? centreOf(metroParks);

  async function find() {
    setLookupError(null);
    setFound(null);
    setFinding(true);
    const result = await findAddress(page.handle, address);
    setFinding(false);
    if (!result.ok) return setLookupError(result.error);
    if (!result.found) return setLookupError("No match for that address. Check the spelling, add the city, or drag the map to place the pin.");
    setPin({ latitude: result.found.latitude, longitude: result.found.longitude });
    setFound(result.found.label);
  }

  function useMyLocation() {
    setLookupError(null);
    setFound(null);
    if (!("geolocation" in navigator)) return setLookupError("This browser can't share its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPin({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setFound("your location");
      },
      () => setLookupError("Couldn't get your location. Allow it in the browser, or use Find on the map."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function discard() {
    setType(startType);
    setShowPin(page.showPin);
    setAddress(page.address ?? "");
    setPin(page.pin);
    setFound(null);
    setLookupError(null);
    setError(null);
  }

  function save() {
    setError(null);
    if (!online && address.trim() && !pin) return setError("Place the pin too: Find on the map, or Use my location.");
    if (!online && pin && !address.trim()) return setError("Write the address as you'd write it, so people know where to go.");
    startTransition(async () => {
      const result = await saveLocation(page.handle, {
        locationType: shop ? { value: type, showPin: type === "by_appointment" ? showPin : true } : null,
        address,
        pin,
      });
      if (!result.ok) return setError(result.error);
      setFound(null);
      setSaved("Saved.");
      router.refresh();
    });
  }

  return (
    <>
      <form className="flex max-w-[860px] flex-col px-6 pb-6" onSubmit={(e) => e.preventDefault()}>
        {shop && (
          <Block id="visit-h" title="How people visit" first>
            <div role="radiogroup" aria-labelledby="visit-h" className="flex flex-wrap self-start border-2 border-gl-border">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={type === t.value}
                  onClick={() => setType(t.value)}
                  className={cn(
                    "h-[36px] border-r-2 border-gl-border px-4 type-body-sm font-semibold last:border-r-0 focus-ring",
                    type === t.value ? "bg-gl-text font-bold text-gl-surface" : "bg-gl-surface hover:bg-gl-surface-raised",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Hint>
              Storefront: the pin, hours and Open now show on your page and the map. By appointment: no hours, and the pin
              only if you choose. Online only: no pin or address.
            </Hint>
          </Block>
        )}

        {!online && (
          <Block id="address-h" title={shop ? "Address and pin" : "Base"} first={!shop}>
            {!shop && (
              <Hint>
                Your base is where your meetups can meet, shown on your page. Leave it empty if you don&apos;t have a fixed
                place.
              </Hint>
            )}
            <label htmlFor="address" className="type-label text-gl-text-secondary">
              Address, as you&apos;d write it
            </label>
            <div>
              <Input
                id="address"
                value={address}
                maxLength={200}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void find();
                  }
                }}
                className="type-body-sm"
                autoComplete="street-address"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={find} disabled={finding || address.trim().length < 4}>
                <Icon name="travel_explore" />
                {finding ? "Finding…" : "Find on the map"}
              </Button>
              <Button variant="outline" onClick={useMyLocation}>
                <Icon name="my_location" />
                Use my location
              </Button>
            </div>
            {found && (
              <p role="status" className="flex items-start gap-2 type-body-sm">
                <Icon name="check" size={18} className="mt-px shrink-0" />
                <span>
                  Found {found === "your location" ? "your location" : shortPlace(found)}. Drag the map to put the pin on
                  your door.
                </span>
              </p>
            )}
            {lookupError && (
              <p role="alert" className="type-body-sm text-gl-danger">
                {lookupError}
              </p>
            )}

            {mapCentre ? (
              <>
                <PinMap
                  value={mapCentre}
                  onChange={setPin}
                  label={`Map for ${page.name}'s pin`}
                  marker={shop ? "storefront" : "home_pin"}
                  credit={
                    <>
                      <a href="https://www.openstreetmap.org/copyright" className="text-gl-text-secondary">
                        © OpenStreetMap contributors
                      </a>{" "}
                      · Search by Nominatim
                    </>
                  }
                />
                <Hint>
                  Drag the map so the pin sits on your door. Arrow keys move the map too. The pin is what Directions and the
                  map use; the address is shown as you wrote it.
                </Hint>
                {!pin && <Hint>The map is on {page.metro?.name ?? "your city"} for now. Find the address to place the pin.</Hint>}
              </>
            ) : (
              <Hint>Find the address, or use your location, to place the pin.</Hint>
            )}

            {outside && (
              <Notice icon="warning" tone="warning">
                This pin is outside {page.metro!.name}. Your city decides who sees your posts in Near you, so it stays{" "}
                {page.metro!.name} until we change it. If {page.name} has moved,{" "}
                <a href="mailto:support@grindylocks.com" className="underline">
                  email support@grindylocks.com
                </a>
                . The pin still saves.
              </Notice>
            )}

            {shop && type === "by_appointment" && (
              <label className="flex items-start gap-2.5 type-body-sm">
                <input
                  type="checkbox"
                  checked={showPin}
                  onChange={(e) => setShowPin(e.target.checked)}
                  className="mt-0.5 size-[18px] shrink-0 accent-gl-accent focus-ring"
                />
                <span>
                  <strong>Show the pin on the map</strong> · by appointment only. Leave it off if the shop is run from a home;
                  your page then shows the city only. Storefronts always show their pin.
                </span>
              </label>
            )}

            {!shop && (page.pin || pin) && (
              <Button
                variant="danger"
                className="self-start"
                onClick={() => {
                  setPin(null);
                  setAddress("");
                  setFound(null);
                }}
              >
                Remove the base
              </Button>
            )}
          </Block>
        )}

        <Block id="city-h" title="City">
          <p className="type-body font-semibold">{page.metro?.name ?? "Not set yet"}</p>
          <Hint>
            Your city decides who sees your posts in Near you, so Grindylocks sets it.{" "}
            <a href="mailto:support@grindylocks.com" className="text-gl-accent-text underline">
              Email us
            </a>{" "}
            if you&apos;ve moved to another city.
          </Hint>
        </Block>
      </form>
      <SaveBar changes={changes} pending={pending} error={error} saved={saved && !changes.length ? saved : null} onDiscard={discard} onSave={save} />
    </>
  );
}

function samePin(a: LatLng | null, b: LatLng | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.latitude - b.latitude) < 1e-7 && Math.abs(a.longitude - b.longitude) < 1e-7;
}

function centreOf(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  return {
    latitude: points.reduce((s, p) => s + p.latitude, 0) / points.length,
    longitude: points.reduce((s, p) => s + p.longitude, 0) / points.length,
  };
}

function km(a: LatLng, b: LatLng) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function nearestKm(pin: LatLng, points: LatLng[]) {
  return Math.min(...points.map((p) => km(pin, p)));
}

/** Nominatim's long label, down to the first three parts ("Bregnerødgade 18, Nørrebro, København"). */
function shortPlace(label: string) {
  return label.split(",").slice(0, 3).join(",").trim();
}
