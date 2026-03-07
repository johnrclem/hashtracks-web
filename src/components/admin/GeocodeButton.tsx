"use client";

import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { geocodeAddress } from "@/lib/geo";

interface GeocodeButtonProps {
  getAddress: () => string | null;
  latInputId: string;
  lngInputId: string;
}

export function GeocodeButton({ getAddress, latInputId, lngInputId }: Readonly<GeocodeButtonProps>) {
  const [isGeocoding, setIsGeocoding] = useState(false);

  async function handleGeocode() {
    const address = getAddress();
    if (!address) return;
    setIsGeocoding(true);
    try {
      const result = await geocodeAddress(address);
      if (result) {
        const latInput = document.getElementById(latInputId) as HTMLInputElement;
        const lngInput = document.getElementById(lngInputId) as HTMLInputElement;
        if (latInput) latInput.value = String(result.lat);
        if (lngInput) lngInput.value = String(result.lng);
        toast.success(`Found: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`);
      } else {
        toast.error("Could not geocode this location");
      }
    } finally {
      setIsGeocoding(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      onClick={handleGeocode}
      disabled={isGeocoding}
    >
      {isGeocoding ? (
        <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Geocoding...</>
      ) : (
        <><MapPin className="mr-1 h-3 w-3" />Auto-fill from name</>
      )}
    </Button>
  );
}
