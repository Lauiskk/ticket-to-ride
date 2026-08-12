import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global Error Boundary — catches unhandled React errors.
 * Shows a fallback UI with a "Recarregar" button.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-board-cream flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 bg-board-crimson/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-4xl">⚠️</span>
            </div>
            <h1 className="font-display text-2xl font-bold text-board-navy mb-3">
              Algo deu errado
            </h1>
            <p className="text-board-navy/60 mb-6">
              Ocorreu um erro inesperado. Tente recarregar a página.
            </p>
            <button onClick={this.handleReload} className="btn-primary">
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
