import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthLayout, SignIn, SignUp } from "./pages/auth";
import { DocumentPage, FolderPage, OrganizationHome, SearchPage } from "./pages/content";
import { AccessPage, ApiKeysPage, AuditPage, MembersPage } from "./pages/organization";
import { OrganizationLayout } from "./pages/organization-layout";
import { Onboarding, Start } from "./pages/start";

// What a member sees changes with what others share: reload when coming back to the page, not on a timer
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });

const router = createBrowserRouter([
  { path: "/", element: <Start /> },
  { path: "/onboarding", element: <Onboarding /> },
  {
    element: <AuthLayout />,
    children: [
      { path: "/sign-in", element: <SignIn /> },
      { path: "/sign-up", element: <SignUp /> },
    ],
  },
  {
    path: "/o/:org",
    element: <OrganizationLayout />,
    children: [
      { index: true, element: <OrganizationHome /> },
      { path: "f/:id", element: <FolderPage /> },
      { path: "d/:id", element: <DocumentPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "members", element: <MembersPage /> },
      { path: "access", element: <AccessPage /> },
      { path: "audit", element: <AuditPage /> },
      { path: "api-keys", element: <ApiKeysPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
