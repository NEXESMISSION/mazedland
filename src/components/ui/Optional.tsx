"use client";

import { Component, type ReactNode } from "react";
import { reportClientError } from "@/components/observability/ClientErrorReporter";

/**
 * For a part of the shell the page can live without — the notification bell,
 * the popups. These load their code on their own after the page, so a tab
 * opened before a deploy, or a connection that drops at the wrong moment,
 * can fail to fetch it. Without a boundary that failure climbed to the root
 * and replaced the whole site with « Une erreur est survenue »; here the
 * piece is simply left out (or shows `fallback`), and the error is reported.
 */
export class Optional extends Component<{ children: ReactNode; fallback?: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    reportClientError({ message: `[${this.props.name}] ${error?.message ?? "render error"}`, stack: error?.stack, kind: "optional-boundary" });
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
