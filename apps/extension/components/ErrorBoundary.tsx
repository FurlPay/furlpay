import React, { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * ErrorBoundary — catches React rendering errors and displays a branded
 * fallback screen using FurlPay design tokens from global.css.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[FurlPay] Uncaught rendering error:", error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={styles.container}>
        {/* Shield / warning icon */}
        <div style={styles.iconWrap}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={styles.icon}
          >
            <path d="M12 2L3 7v5c0 5.25 3.75 10.06 9 11 5.25-.94 9-5.75 9-11V7l-9-5z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <circle cx="12" cy="16" r="0.5" fill="currentColor" />
          </svg>
        </div>

        <h1 style={styles.title}>Something went wrong</h1>

        {this.state.error?.message && (
          <p style={styles.message}>{this.state.error.message}</p>
        )}

        <button
          onClick={this.handleReload}
          style={styles.reloadBtn}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              "translateY(-1px)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 6px 22px -4px rgba(0, 229, 153, 0.5)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "none";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 4px 14px -2px rgba(0, 229, 153, 0.35)";
          }}
        >
          Reload Extension
        </button>

        <a
          href="https://furlpay.com/contact"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.reportLink}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = "#00e599";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = "#a1a1aa";
          }}
        >
          Report Issue
        </a>
      </div>
    );
  }
}

/* ---------------------------------------------------------------------------
   Inline styles using FurlPay design tokens (CSS variable fallbacks for
   environments where global.css may not have loaded).
--------------------------------------------------------------------------- */
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    padding: "32px 24px",
    background: "var(--fp-bg-primary, #08080a)",
    fontFamily:
      'var(--fp-font-sans, "Inter", "Outfit", -apple-system, "Segoe UI", sans-serif)',
    textAlign: "center",
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255, 69, 58, 0.1)",
    border: "1px solid rgba(255, 69, 58, 0.25)",
    marginBottom: 20,
  },
  icon: {
    color: "#ff6b61",
  },
  title: {
    margin: "0 0 8px",
    fontSize: "1.2rem",
    fontWeight: 700,
    color: "var(--fp-text-primary, #ffffff)",
    letterSpacing: "-0.01em",
  },
  message: {
    margin: "0 0 24px",
    fontSize: "0.82rem",
    color: "var(--fp-text-secondary, #a1a1aa)",
    lineHeight: 1.5,
    maxWidth: 280,
    wordBreak: "break-word",
  },
  reloadBtn: {
    background: "var(--fp-gradient, linear-gradient(135deg, #00e599, #00b87a))",
    color: "#04140e",
    border: "none",
    borderRadius: "var(--fp-radius-md, 12px)",
    padding: "11px 28px",
    fontWeight: 700,
    fontSize: "0.9rem",
    cursor: "pointer",
    boxShadow: "0 4px 14px -2px rgba(0, 229, 153, 0.35)",
    transition: "transform 0.15s ease, box-shadow 0.2s ease",
    fontFamily: "inherit",
    marginBottom: 14,
  },
  reportLink: {
    fontSize: "0.78rem",
    color: "var(--fp-text-secondary, #a1a1aa)",
    textDecoration: "none",
    transition: "color 0.15s ease",
  },
};

export default ErrorBoundary;
export { ErrorBoundary };
