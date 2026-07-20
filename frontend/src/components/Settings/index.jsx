import DataProviders from "./DataProviders.jsx";
import LLMProviders from "./LLMProviders.jsx";

export default function Settings() {
  return (
    <div className="rd-page panel">
      <div className="panel-head"><h2>Settings — providers &amp; models</h2></div>
      <div className="panel-body">
        <div className="settings-block">
          <h3>Market data</h3>
          <DataProviders />
        </div>
        <div className="settings-block">
          <h3>LLM providers &amp; models</h3>
          <LLMProviders />
        </div>
      </div>
    </div>
  );
}
