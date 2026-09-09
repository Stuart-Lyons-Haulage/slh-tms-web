import { useEffect, useState } from "react";
import { CustomerLoadPlanActions } from "../components/CustomerLoadPlanActions";
import { DispatchBoard } from "../components/dispatch/DispatchBoard";
import "../authoritative-dispatch.css";

function currentDispatchDate() {
  return new URLSearchParams(window.location.search).get("date") || new Date().toISOString().slice(0, 10);
}

export function DriverDispatchOperational() {
  const [dispatchDate, setDispatchDate] = useState(currentDispatchDate);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("date", dispatchDate);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [dispatchDate]);

  return <DispatchBoard
    planningDate={dispatchDate}
    onPlanningDateChange={setDispatchDate}
    extraActions={<CustomerLoadPlanActions date={dispatchDate} />}
  />;
}
