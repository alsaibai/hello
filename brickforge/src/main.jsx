import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: 24, font: '13px system-ui' }} role="alert">
        <b>Something went wrong.</b> Reload the page. If it keeps happening, the message below helps.
        <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.err && this.state.err.message)}</pre>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);
