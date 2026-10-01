import type { Metadata } from "next";

export const privacyContact = "team@xem.email";
export const privacyEmailLink = `mailto:${privacyContact}`;
export const deletionEmailLink = `${privacyEmailLink}?subject=Xem%20data%20deletion%20request`;

// These pages remain visibly draft and unindexed until the operational checks in
// docs/privacy-operations.md are complete. Do not treat copy as deployment proof.
export function privacyMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title: `${title} | Xem`,
    description,
    alternates: { canonical: path },
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      title: `${title} | Xem`,
      description,
      url: path,
      images: ["/opengraph-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | Xem`,
      description,
    },
  };
}
