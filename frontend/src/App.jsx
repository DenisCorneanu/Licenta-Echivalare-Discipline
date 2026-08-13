import { useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import OperatorPage from "./pages/Operator.jsx";
import AdminPage from "./pages/Admin.jsx";

const ADMIN_SESSION_KEY = "echivalare_admin_logged_in";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin";

function AppRoutes() {
  const navigate = useNavigate();
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(
    () => sessionStorage.getItem(ADMIN_SESSION_KEY) === "true"
  );

  const handleAdminLogin = ({ username, password }) => {
    const isValid =
      username === ADMIN_USERNAME && password === ADMIN_PASSWORD;

    if (!isValid) {
      return false;
    }

    sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
    setIsAdminLoggedIn(true);
    navigate("/admin");

    return true;
  };

  const handleAdminLogout = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setIsAdminLoggedIn(false);
    navigate("/");
  };

  return (
    <Routes>
      <Route
        path="/"
        element={<OperatorPage onAdminLogin={handleAdminLogin} />}
      />

      <Route
        path="/admin"
        element={
          isAdminLoggedIn ? (
            <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
              <AdminPage onLogout={handleAdminLogout} />
            </div>
          ) : (
            <Navigate to="/" replace />
          )
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
