import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";
import { LayoutWrapper } from "./pages/Layout";
import { Dashboard } from "./pages/Dashboard";
import { ReviewPage } from "./pages/ReviewPage";
import { StatsPage } from "./pages/StatsPage";
import { DecksPage } from "./pages/DecksPage";
import { SettingsPage } from "./pages/SettingsPage"; // New import

const router = createBrowserRouter([
  {
    path: "/",
    element: <LayoutWrapper />,
    children: [
      {
        path: "/",
        element: <Dashboard />,
      },
      {
        path: "review",
        element: <ReviewPage />,
      },
      {
        path: "decks",
        element: <DecksPage />,
      },
      {
        path: "stats",
        element: <StatsPage />,
      },
      { 
        path: "settings",
        element: <SettingsPage />,
      },
    ],
  },
]);


export default function App() {
    return <RouterProvider router={router} />;
}
