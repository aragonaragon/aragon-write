import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__box">
            <AlertTriangle size={48} style={{ color: "#ea4335", marginBottom: 16 }} />
            <h1>عذراً، حدث خطأ غير متوقع</h1>
            <p>لا تقلق — كتاباتك محفوظة. اضغط زر التحديث للمتابعة.</p>
            {this.state.error?.message && (
              <pre className="error-boundary__detail">{this.state.error.message}</pre>
            )}
            <button className="btn btn-primary" onClick={this.handleReload}>
              <RotateCcw size={16} /> تحديث التطبيق
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
