import { getTheme } from "@/themes";
import type { ThemeViewModel } from "@/themes/types";

export function ThemeHost({
  themeId,
  view
}: {
  themeId: string | null | undefined;
  view: ThemeViewModel;
}) {
  const theme = getTheme(themeId);

  switch (view.view) {
    case "home": {
      const Slot = theme.slots.Home;
      return <Slot model={view} />;
    }
    case "collection": {
      const Slot = theme.slots.Collection;
      return <Slot model={view} />;
    }
    case "entry": {
      const Slot = theme.slots.Entry;
      return <Slot model={view} />;
    }
    case "page": {
      const Slot = theme.slots.Page;
      return <Slot model={view} />;
    }
    case "not-found": {
      const Slot = theme.slots.NotFound;
      return <Slot model={view} />;
    }
    default: {
      const unsupportedView: never = view;
      return unsupportedView;
    }
  }
}
