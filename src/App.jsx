
import { useMemo, useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import "./App.css";
import { supabase } from "./lib/supabase.js";


const initialEmployees = [
  { name: "SANDI WIDAYU", position: "HEAD CHEF", salary: 2400000, overtime: 30, sales: 38000, cash: "cash" },
  { name: "EKO PRAYUDA", position: "SENIOR COOK", salary: 1900000, overtime: 45, sales: 38000 },
  { name: "GALMA ZAINUL QIYAM", position: "COOK", salary: 1600000, overtime: 60, sales: 38000 },
  { name: "SULISTIOWATI", position: "ASISTEN COOK", salary: 1500000, overtime: 50, sales: 38000 },
  { name: "ANDI SETIAWAN", position: "STEWARD", salary: 1500000, overtime: 50, sales: 38000 },
  { name: "INDRA FEBRIAWAN", position: "SENIOR BARISTA", salary: 1900000, overtime: 60, sales: 38000 },
  { name: "NINA ARULHISSIYA", position: "BARISTA", salary: 1400000, overtime: 33, sales: 38000 },
  { name: "AGUSTINE CHANDRA", position: "SERVER", salary: 1800000, overtime: 0, sales: 38000 },
  { name: "RAMA MAYANG SINTA", position: "SERVER", salary: 1800000, overtime: 0, sales: 38000 },
  { name: "KHOIRUL AZIZ", position: "SENIOR SERVER", salary: 2000000, overtime: 1, sales: 38000 },
  { name: "MIFTAKHUL NAJIB", position: "ADMIN", salary: 1700000, overtime: 36, sales: 38000 },
  { name: "DIKA", position: "OB", salary: 1600000, overtime: 49, sales: 38000 },
  { name: "MBAH NO", position: "-", salary: 1000000, overtime: 0, sales: 0 },
];


const money = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);

const calculate = (employee) => {
  const overtimePay = (employee.salary / 173) * employee.overtime;
  const totalBefore = employee.salary + overtimePay;
  const totalPayroll =
    totalBefore -
    (employee.bonDeduction || 0) +
    (employee.bonus || 0);
  const totalWithSales = totalPayroll + (employee.sales || 0);

  return {
    overtimePay,
    totalBefore,
    remainingBon: (employee.bon || 0) - (employee.potong || 0),
    totalPayroll,
    totalWithSales,
  };
};

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [staffProfile, setStaffProfile] = useState(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeDbMessage, setEmployeeDbMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data?.session || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession || null);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    if (error) setAuthError(error.message);
    setAuthBusy(false);
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(`Gagal keluar: ${error.message}`);
    else {
      setSession(null);
      setStaffProfile(null);
      setEmployees([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadSignedInWorkspace = async () => {
      if (!session?.user) {
        setStaffProfile(null);
        setEmployees([]);
        return;
      }
      setEmployeeLoading(true);
      setAuthError("");
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, role, employee_id")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profileError || !profile || !["owner", "admin", "hr"].includes(profile.role)) {
        await supabase.auth.signOut();
        setAuthError(profileError?.message || "Akun belum diberi hak akses payroll. Hubungi owner untuk mengaktifkan profil admin.");
        setSession(null);
        setEmployeeLoading(false);
        return;
      }
      setStaffProfile(profile);
      let { data: rows, error: employeeError } = await supabase
        .from("employees")
        .select("id, employee_code, full_name, position, base_salary, phone, is_active")
        .order("full_name", { ascending: true });
      if (employeeError) {
        if (!cancelled) setAuthError(`Gagal memuat data karyawan: ${employeeError.message}`);
        setEmployeeLoading(false);
        return;
      }
      // Migrasi awal: masukkan daftar bawaan satu kali jika tabel Supabase masih kosong.
      if ((rows || []).length === 0) {
        const seedRows = initialEmployees.map((employee, index) => ({
          employee_code: `SD-${String(index + 1).padStart(3, "0")}`,
          full_name: employee.name,
          position: employee.position,
          base_salary: Number(employee.salary || 0),
          phone: employee.phone || null,
          is_active: true,
        }));
        const { data: inserted, error: seedError } = await supabase
          .from("employees")
          .insert(seedRows)
          .select("id, employee_code, full_name, position, base_salary, phone, is_active");
        if (seedError) {
          if (!cancelled) setAuthError(`Gagal menyiapkan data karyawan awal: ${seedError.message}`);
          setEmployeeLoading(false);
          return;
        }
        rows = inserted || [];
      }
      if (!cancelled) {
        setEmployees((rows || []).map((row) => ({
          id: row.id,
          employeeCode: row.employee_code || "",
          name: row.full_name,
          position: row.position || "-",
          salary: Number(row.base_salary || 0),
          phone: row.phone || "",
          status: row.is_active ? "aktif" : "nonaktif",
          overtime: 0,
          sales: 0,
          cash: "",
        })));
        setEmployeeDbMessage("Data karyawan tersinkron dengan Supabase.");
      }
      setEmployeeLoading(false);
    };
    loadSignedInWorkspace();
    return () => { cancelled = true; };
  }, [session?.user?.id]);
  const [appSettings, setAppSettings] = useState(() => {
    const defaults = {
      businessName: "RESTO & CAFE SISI DANAU",
      businessAddress: "",
      businessPhone: "",
      adminWhatsapp: "",
      payrollDate: " akhir bulan",
      normalWorkHours: 8,
      overtimeDivisor: 173,
    };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem("sisi-danau-app-settings") || "{}") };
    } catch {
      return defaults;
    }
  });
  const [settingsMessage, setSettingsMessage] = useState("");
  const saveAppSettings = (event) => {
    event.preventDefault();
    localStorage.setItem("sisi-danau-app-settings", JSON.stringify(appSettings));
    setSettingsMessage("Pengaturan berhasil disimpan pada perangkat ini.");
  };
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("November 2026");
  const [salaryReportArchives, setSalaryReportArchives] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sisi-danau-salary-report-archives") || "[]"); }
    catch { return []; }
  });
  const [selectedSalaryArchive, setSelectedSalaryArchive] = useState("");
  const [salaryArchiveMessage, setSalaryArchiveMessage] = useState("");
  useEffect(() => {
    localStorage.setItem("sisi-danau-salary-report-archives", JSON.stringify(salaryReportArchives));
  }, [salaryReportArchives]);
  const excelInputRef = useRef(null);
  const [importMessage, setImportMessage] = useState("");
 const attendanceInputRef = useRef(null);
const [attendanceMessage, setAttendanceMessage] = useState("");
const [attendanceSummary, setAttendanceSummary] = useState([]);
const [attendanceDailyRecords, setAttendanceDailyRecords] = useState([]);
const [attendanceErrors, setAttendanceErrors] = useState([]);

const parseWorkHours = (value) => {
  if (typeof value === "number") {
    // Excel menyimpan waktu sebagai pecahan hari.
    // Floor menghilangkan detik.
    return Math.floor(value * 1440 + 0.000001) / 60;
  }

  const text = String(value || "").trim();

  // Format HH:MM:SS
  const timeMatch = text.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/);

  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    return hours + minutes / 60;
  }

  // Format: 8 Jam 25 Menit 30 Detik
  const hours = Number(text.match(/(\d+)\s*Jam/i)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)\s*Menit/i)?.[1] || 0);

  // Detik sengaja tidak dibaca.
  return hours + minutes / 60;
};

const formatHoursMinutes = (totalMinutes) => {
  const minutes = Math.floor(totalMinutes || 0);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours} jam ${remainingMinutes} menit`;
};
const handleImportAttendance = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Header berada di baris 11, data dimulai di baris 12.
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      range: 11,
      defval: "",
    });

    const validNames = new Set(
      employees.map((employee) => employee.name.toUpperCase().trim())
    );

    const dailyRecords = new Map();
    const unknownNames = new Set();
    const errorRows = [];
let invalidRows = 0;

    rows.forEach((row) => {
      const date = String(row[0] || "").trim();
      const name = String(row[1] || "").trim().toUpperCase();
      const workHours = parseWorkHours(row[5]);

      if (!date || !name || !Number.isFinite(workHours) || workHours <= 0) {
  invalidRows++;

  let reason = "Data tidak valid";

  if (!date) reason = "Tanggal kosong";
  else if (!name) reason = "Nama karyawan kosong";
  else if (!Number.isFinite(workHours) || workHours <= 0) {
    reason = "Durasi kerja kosong atau tidak valid";
  }

  errorRows.push({
    rowNumber: 12 + rows.indexOf(row),
    date,
    name,
    workHours: row[5],
    reason,
  });

  return;
}

     if (!validNames.has(name)) {
  unknownNames.add(name);

  errorRows.push({
    rowNumber: 12 + rows.indexOf(row),
    date,
    name,
    workHours: row[5],
    reason: "Nama karyawan tidak terdaftar",
  });

  return;
}
      const key = `${name}|${date}`;
      const current = dailyRecords.get(key) || {
        name,
        date,
        workHours: 0,
      };

      // Jika ada lebih dari satu catatan pada tanggal yang sama,
      // durasi kerja dijumlahkan sebagai satu hari kerja.
      current.workHours += workHours;
      dailyRecords.set(key, current);
    });

  
const summaryMap = new Map();
const dailyResults = [];

dailyRecords.forEach((record) => {
  // Semua perhitungan menggunakan menit utuh.
  const workMinutes = Math.floor(record.workHours * 60);

  // Jam kerja normal 8 jam.
  const overtimeMinutes = Math.max(0, workMinutes - 480);

  // Lembur maksimal 6 jam per hari.
let acceptedOvertimeMinutes = 0;

if (overtimeMinutes <= 360) {
    const remainingMinutes = overtimeMinutes % 60;

    acceptedOvertimeMinutes =
      overtimeMinutes - remainingMinutes +
      (remainingMinutes < 20 ? 0 : remainingMinutes);
  }

  dailyResults.push({
    ...record,
    workMinutes,
    overtimeMinutes: acceptedOvertimeMinutes,
  });

  const current = summaryMap.get(record.name) || {
  name: record.name,
  daysPresent: 0,
  totalWorkMinutes: 0,
  totalOvertimeMinutes: 0,
  totalOvertimeHours: 0,
  totalOvertimeRemainderMinutes: 0,
};

  current.daysPresent += 1;
  current.totalWorkMinutes += workMinutes;
  current.totalOvertimeMinutes += acceptedOvertimeMinutes;
current.totalOvertimeHours += Math.floor(
  acceptedOvertimeMinutes / 60
);

current.totalOvertimeRemainderMinutes +=
  acceptedOvertimeMinutes % 60;
  summaryMap.set(record.name, current);
});

const summary = employees
  .map((employee) => {
    const result = summaryMap.get(employee.name) || {
      name: employee.name,
      daysPresent: 0,
      totalWorkMinutes: 0,
      totalOvertimeMinutes: 0,
      totalOvertimeHours: 0,
totalOvertimeRemainderMinutes: 0,
    };

    return result;
  })
  .sort((a, b) => a.name.localeCompare(b.name, "id"));

dailyResults.sort((a, b) =>
  a.name.localeCompare(b.name, "id") ||
  a.date.localeCompare(b.date)
);

setAttendanceDailyRecords(dailyResults);

setAttendanceErrors(errorRows);

setAttendanceSummary(summary);

setAttendanceMessage(
  `Import berhasil: ${dailyRecords.size} catatan harian. ` +
  `${unknownNames.size} nama tidak dikenal, ${invalidRows} baris tidak valid.`
);

  } catch (error) {
    setAttendanceMessage(`Import absensi gagal: ${error.message}`);
  } finally {
    event.target.value = "";
  }
};
// ================================
// BON KARYAWAN
// ================================

const [bonRecords, setBonRecords] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem("sisi-danau-bon-records") || "[]");
  } catch {
    return [];
  }
});
useEffect(() => {
  localStorage.setItem("sisi-danau-bon-records", JSON.stringify(bonRecords));
}, [bonRecords]);

const [showBonForm, setShowBonForm] = useState(false);
const [selectedBon, setSelectedBon] = useState(null);

const [bonForm, setBonForm] = useState({
  employeeName: "",
  amount: "",
  installmentAmount: "",
  reason: "",
  notes: "",
});

const [bonPaymentForm, setBonPaymentForm] = useState({
  amount: "",
  paymentMethod: "Potong Gaji",
  notes: "",
});
const [editingBon, setEditingBon] = useState(null);

const [bonFilter, setBonFilter] = useState("Semua");
const [bonSearch, setBonSearch] = useState("");
const [bonMessage, setBonMessage] = useState("");

  const [employees, setEmployees] = useState([]);

const handleImportExcel = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Format Gaji.xlsx: dua baris header,
    // data karyawan dimulai dari baris ke-3.
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      range: 2,
      defval: "",
    });

    const importedEmployees = rows
      .filter((row) => String(row[0] ?? "").trim() !== "")
      .map((row) => ({
        name: String(row[0]).trim().toUpperCase(),
        position: String(row[1] || "-").trim().toUpperCase(),
        salary: Number(row[2]) || 0,
        overtime: Math.max(0, Number(row[3]) || 0),
      }))
      .filter((employee) => employee.salary > 0);

    if (importedEmployees.length === 0) {
      throw new Error("Tidak ditemukan data karyawan yang valid.");
    }

    setEmployees((current) => {
      const updated = [...current];

      importedEmployees.forEach((incoming) => {
        const index = updated.findIndex(
          (employee) =>
            employee.name.toLowerCase() === incoming.name.toLowerCase()
        );

        if (index >= 0) {
          updated[index] = {
            ...updated[index],
            ...incoming,
          };
        } else {
          updated.push({
            ...incoming,
            bonus: 0,
            bonusRamadhan: 0,
            sales: 0,
            cash: "",
          });
        }
      });

      return updated;
    });

    setImportMessage(
      `Berhasil membaca ${importedEmployees.length} data karyawan dari ${file.name}.`
    );
  } catch (error) {
    setImportMessage(`Import gagal: ${error.message}`);
  } finally {
    event.target.value = "";
  }
};
const [showAddEmployee, setShowAddEmployee] = useState(false);
const [editingEmployee, setEditingEmployee] = useState(null);
const [formError, setFormError] = useState("");

const [newEmployee, setNewEmployee] = useState({
  name: "",
  position: "",
  salary: "",
  phone: "",
});


const handleAddEmployee = async (event) => {
  event.preventDefault();
  const name = newEmployee.name.trim().toUpperCase();
  const position = newEmployee.position.trim().toUpperCase();
  const salary = Number(newEmployee.salary);
  if (!name || !position || !Number.isFinite(salary) || salary <= 0) {
    setFormError("Lengkapi semua data dengan benar.");
    return;
  }
  if (employees.some((employee) => employee.name.toLowerCase() === name.toLowerCase())) {
    setFormError("Nama karyawan sudah terdaftar.");
    return;
  }
  setFormError("");
  const { data, error } = await supabase.from("employees").insert({
    full_name: name,
    position,
    base_salary: salary,
    phone: newEmployee.phone.trim() || null,
    is_active: true,
  }).select("id, employee_code, full_name, position, base_salary, phone, is_active").single();
  if (error) {
    setFormError(`Gagal menyimpan ke database: ${error.message}`);
    return;
  }
  setEmployees((current) => [...current, {
    id: data.id, employeeCode: data.employee_code || "", name: data.full_name,
    position: data.position || "-", salary: Number(data.base_salary || 0),
    phone: data.phone || "", status: data.is_active ? "aktif" : "nonaktif",
    overtime: 0, bonus: 0, bonusRamadhan: 0, sales: 0, cash: "",
  }]);
  setNewEmployee({ name: "", position: "", salary: "", phone: "" });
  setShowAddEmployee(false);
};

const handleEditEmployee = async (event) => {
  event.preventDefault();
  if (!editingEmployee?.id) {
    alert("ID karyawan tidak ditemukan. Muat ulang data sebelum mengedit.");
    return;
  }
  const name = editingEmployee.name.trim().toUpperCase();
  const position = editingEmployee.position.trim().toUpperCase();
  const salary = Number(editingEmployee.salary);
  if (!name || !position || !Number.isFinite(salary) || salary <= 0) {
    alert("Lengkapi semua data dengan benar.");
    return;
  }
  const duplicate = employees.some((employee) =>
    employee.id !== editingEmployee.id && employee.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    alert("Nama karyawan sudah terdaftar.");
    return;
  }
  const { data, error } = await supabase.from("employees").update({
    full_name: name,
    position,
    base_salary: salary,
    phone: String(editingEmployee.phone || "").trim() || null,
    updated_at: new Date().toISOString(),
  }).eq("id", editingEmployee.id)
    .select("id, employee_code, full_name, position, base_salary, phone, is_active")
    .maybeSingle();
  if (error) {
    alert(`Perubahan gagal disimpan ke Supabase: ${error.message}`);
    return;
  }
  if (!data) {
    alert("Data tidak berubah. Periksa hak akses akun (owner/admin/HR) dan kebijakan RLS.");
    return;
  }
  setEmployees((current) => current.map((employee) => employee.id === data.id ? {
    ...employee,
    employeeCode: data.employee_code || employee.employeeCode || "",
    name: data.full_name,
    position: data.position || "-",
    salary: Number(data.base_salary || 0),
    phone: data.phone || "",
    status: data.is_active ? "aktif" : "nonaktif",
  } : employee));
  setEditingEmployee(null);
};

const handleDeleteEmployee = async (employee) => {
  const confirmed = window.confirm(`Yakin ingin menghapus karyawan ${employee.name}?`);
  if (!confirmed) return;
  if (!employee.id) {
    alert("ID karyawan tidak ditemukan. Data belum tersinkron dengan database.");
    return;
  }
  const { error } = await supabase.from("employees").delete().eq("id", employee.id);
  if (error) {
    alert(`Karyawan gagal dihapus: ${error.message}`);
    return;
  }
  setEmployees((current) => current.filter((item) => item.id !== employee.id));
};


const handleSubmitBon = (event) => {
  event.preventDefault();
  const amount = Number(bonForm.amount);
  const installmentAmount = Number(bonForm.installmentAmount);

  if (!bonForm.employeeName || !bonForm.reason.trim()) {
    setBonMessage("Pilih karyawan dan isi keterangan bon.");
    return;
  }
  if (amount <= 0 || installmentAmount <= 0 || installmentAmount > amount) {
    setBonMessage("Nominal bon dan cicilan harus valid. Cicilan tidak boleh melebihi bon.");
    return;
  }

  const now = new Date().toISOString();
  const newBon = {
    id: crypto.randomUUID(),
    employeeName: bonForm.employeeName,
    amount,
    installmentAmount,
    originalInstallmentAmount: installmentAmount,
    installmentChanges: [],
    reason: bonForm.reason.trim(),
    notes: bonForm.notes.trim(),
    paidAmount: 0,
    status: "active",
    createdAt: now,
    createdBy: "Administrator",
    payments: [],
  };

  setBonRecords((current) => [newBon, ...current]);
  setBonForm({ employeeName: "", amount: "", installmentAmount: "", reason: "", notes: "" });
  setShowBonForm(false);
  setBonMessage("Bon berhasil dicatat dan langsung aktif untuk potongan gaji bulanan.");
};

const handleEditInstallment = (bon) => {
  const input = window.prompt(
    `Cicilan baru per bulan untuk ${bon.employeeName} (Rp):`,
    String(bon.installmentAmount)
  );
  if (input === null) return;
  const nextAmount = Number(input);
  const remaining = bon.amount - bon.paidAmount;
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    alert("Nominal cicilan harus lebih dari nol.");
    return;
  }
  const changedAt = new Date().toISOString();
  setBonRecords((current) => current.map((item) =>
    item.id === bon.id
      ? {
          ...item,
          installmentAmount: nextAmount,
          installmentChanges: [
            ...(item.installmentChanges || []),
            { from: item.installmentAmount, to: nextAmount, changedAt, changedBy: "Administrator" },
          ],
          status: remaining <= 0 ? "paid" : "active",
        }
      : item
  ));
  setBonMessage(`Cicilan diperbarui menjadi ${money(nextAmount)} per bulan.`);
};

const handleProcessMonthlyBon = () => {
  const activeBon = bonRecords.filter((bon) => bon.status === "active" && bon.amount > bon.paidAmount);
  const dueBon = activeBon.filter((bon) =>
    !(bon.payments || []).some((payment) =>
      payment.paymentMethod === "Potong Gaji" && payment.payrollPeriod === month
    )
  );
  if (dueBon.length === 0) {
    setBonMessage("Tidak ada cicilan bon yang perlu diproses untuk periode ini, atau potongan sudah pernah dicatat.");
    return;
  }
  if (!window.confirm(`Proses potongan otomatis ${dueBon.length} bon aktif untuk periode ${month}?`)) return;

  const processedAt = new Date().toISOString();
  setBonRecords((current) => current.map((bon) => {
    if (!dueBon.some((item) => item.id === bon.id)) return bon;
    const remaining = bon.amount - bon.paidAmount;
    const deduction = Math.min(bon.installmentAmount, remaining);
    const payment = {
      id: crypto.randomUUID(),
      amount: deduction,
      paymentDate: processedAt,
      payrollPeriod: month,
      paymentMethod: "Potong Gaji",
      notes: "Potongan cicilan otomatis dari payroll",
      recordedBy: "Administrator",
    };
    const paidAmount = bon.paidAmount + deduction;
    return {
      ...bon,
      paidAmount,
      payments: [...(bon.payments || []), payment],
      status: paidAmount >= bon.amount ? "paid" : "active",
    };
  }));
  setBonMessage(`Potongan bon periode ${month} berhasil dicatat. Periksa kembali daftar penggajian.`);
};

const handleDeleteBon = (id) => {
  const bon = bonRecords.find((item) => item.id === id);
  if (!bon) return;

  const paymentCount = (bon.payments || []).length;
  const paidAmount = Number(bon.paidAmount || 0);
  const warning = paymentCount > 0
    ? `\\n\\nBon ini sudah memiliki ${paymentCount} riwayat potongan dengan total ${money(paidAmount)}. Jika dihapus, catatan bon dan seluruh riwayat potongannya akan dihapus dari aplikasi dan perhitungan payroll terkait akan diperbarui.`
    : "";

  if (!window.confirm(`Yakin ingin menghapus bon ${bon.employeeName} sebesar ${money(bon.amount)}?${warning}`)) return;

  setBonRecords((current) => current.filter((item) => item.id !== id));
  if (selectedBon?.id === id) setSelectedBon(null);
  setBonMessage(`Catatan bon ${bon.employeeName} berhasil dihapus.`);
};

const filteredBonRecords = bonRecords.filter((bon) => {
  const matchesStatus = bonFilter === "Semua" || bon.status === bonFilter;
  const matchesSearch = `${bon.employeeName} ${bon.reason}`.toLowerCase().includes(bonSearch.toLowerCase());
  return matchesStatus && matchesSearch;
});

const totalBonApproved = bonRecords.reduce((sum, bon) => sum + bon.amount, 0);
const totalBonPaid = bonRecords.reduce((sum, bon) => sum + (bon.paidAmount || 0), 0);
const totalBonRemaining = bonRecords.reduce((sum, bon) => sum + bon.amount - (bon.paidAmount || 0), 0);

const monthlyBonDeductionByEmployee = useMemo(() => {
  const result = {};
  bonRecords.forEach((bon) => {
    const monthPayments = (bon.payments || []).filter(
      (payment) => payment.paymentMethod === "Potong Gaji" && payment.payrollPeriod === month
    );
    const alreadyRecorded = monthPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const alreadyProcessed = monthPayments.length > 0;
    const remaining = bon.amount - bon.paidAmount;
    const pendingDue = !alreadyProcessed && bon.status === "active" && remaining > 0
      ? Math.min(bon.installmentAmount, remaining)
      : 0;
    const periodDeduction = alreadyRecorded + pendingDue;
    if (periodDeduction > 0) {
      result[bon.employeeName] = (result[bon.employeeName] || 0) + periodDeduction;
    }
  });
  return result;
}, [bonRecords, month]);


// ================================
// BONUS & PENJUALAN
// ================================
const [bonusRecords, setBonusRecords] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem("sisi-danau-bonus-records") || "[]");
  } catch {
    return [];
  }
});
useEffect(() => {
  localStorage.setItem("sisi-danau-bonus-records", JSON.stringify(bonusRecords));
}, [bonusRecords]);

const [reservationEntries, setReservationEntries] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem("sisi-danau-reservation-entries") || "[]");
  } catch {
    return [];
  }
});
useEffect(() => {
  localStorage.setItem("sisi-danau-reservation-entries", JSON.stringify(reservationEntries));
}, [reservationEntries]);
const [reservationDate, setReservationDate] = useState(() => new Date().toISOString().slice(0, 10));

const [bonusType, setBonusType] = useState("target");
const [bonusMessage, setBonusMessage] = useState("");
const [bonusForm, setBonusForm] = useState({
  employeeName: "",
  amount: "",
  description: "",
  foodCount: "",
  drinkCount: "",
  transactionValue: "",
  reservationName: "",
});

const bonusPeriodRecords = bonusRecords.filter((record) => record.period === month);
const bonusByEmployee = useMemo(() => {
  const totals = {};
  bonusPeriodRecords.forEach((record) => {
    totals[record.employeeName] = (totals[record.employeeName] || 0) + Number(record.amount || 0);
  });
  return totals;
}, [bonusRecords, month]);

const resetBonusForm = () => setBonusForm({
  employeeName: "", amount: "", description: "", foodCount: "",
  drinkCount: "", transactionValue: "", reservationName: "",
});

const handleSaveReservationEntry = (event) => {
  event.preventDefault();
  const transactionValue = Number(bonusForm.transactionValue);
  if (!reservationDate || !Number.isFinite(transactionValue) || transactionValue <= 0) {
    setBonusMessage("Isi tanggal dan nilai transaksi reservasi yang valid.");
    return;
  }
  const entry = {
    id: crypto.randomUUID(),
    date: reservationDate,
    reservationName: bonusForm.reservationName.trim() || "Tanpa nama",
    transactionValue: Math.round(transactionValue),
    bonusAmount: Math.round(transactionValue * 0.05),
    period: month,
    createdAt: new Date().toISOString(),
    processedAt: null,
  };
  setReservationEntries((current) => [entry, ...current]);
  setBonusForm((current) => ({ ...current, transactionValue: "", reservationName: "" }));
  setBonusMessage("Reservasi berhasil ditambahkan ke daftar. Belum masuk payroll.");
};

const handleDeleteReservationEntry = (entryId) => {
  const entry = reservationEntries.find((item) => item.id === entryId);
  if (!entry || entry.processedAt) return;
  if (!window.confirm(`Hapus reservasi ${entry.reservationName} dari daftar?`)) return;
  setReservationEntries((current) => current.filter((item) => item.id !== entryId));
};

const handleProcessReservationPayroll = () => {
  if (pendingReservationEntries.length === 0) {
    setBonusMessage("Tidak ada reservasi baru yang menunggu diproses ke payroll.");
    return;
  }
  if (reservationEligibleEmployees.length === 0) {
    setBonusMessage("Tidak ada karyawan aktif yang memenuhi syarat pembagian bonus reservasi.");
    return;
  }
  const totalBonus = pendingReservationBonusTotal;
  if (!window.confirm(
    `Proses ${pendingReservationEntries.length} reservasi periode ${month}? Total transaksi ${money(pendingReservationTransactionTotal)}, bonus 5% ${money(totalBonus)} akan dibagi kepada ${reservationEligibleEmployees.length} karyawan aktif (Mbah No tidak termasuk).`
  )) return;

  const baseShare = Math.floor(totalBonus / reservationEligibleEmployees.length);
  let remainder = totalBonus - baseShare * reservationEligibleEmployees.length;
  const batchId = crypto.randomUUID();
  const description = pendingReservationEntries.map((entry) => `${entry.reservationName} (${entry.date})`).join(", ");
  const additions = reservationEligibleEmployees.map((employee) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return {
      id: crypto.randomUUID(), batchId, type: "reservation",
      typeLabel: "Bonus Reservasi", employeeName: employee.name,
      amount: baseShare + extra, transactionValue: pendingReservationTransactionTotal,
      percentage: 5,
      description: `Bonus reservasi 5% dari ${pendingReservationEntries.length} reservasi: ${description}`,
      period: month, createdAt: new Date().toISOString(), createdBy: "Administrator",
    };
  });
  setBonusRecords((current) => [...additions, ...current]);
  const processedIds = new Set(pendingReservationEntries.map((entry) => entry.id));
  const processedAt = new Date().toISOString();
  setReservationEntries((current) => current.map((entry) =>
    processedIds.has(entry.id) ? { ...entry, processedAt, payrollBatchId: batchId } : entry
  ));
  setBonusMessage(`Bonus reservasi ${money(totalBonus)} berhasil dibagi ke ${reservationEligibleEmployees.length} karyawan dan dimasukkan ke payroll ${month}.`);
};

const handleSaveBonus = (event) => {
  event.preventDefault();
  if (bonusType === "reservation") {
    handleSaveReservationEntry(event);
    return;
  }
  const now = new Date().toISOString();
  const period = month;
  let additions = [];

  if (bonusType === "target") {
    const productCount = Math.floor(Number(bonusForm.transactionValue));
    // Mbah No dikecualikan dari pembagian bonus target.
    const activeEmployees = employees.filter((employee) =>
      employee.status !== "nonaktif" &&
      employee.name.trim().toUpperCase() !== "MBAH NO"
    );
    if (!Number.isFinite(productCount) || productCount <= 0 || activeEmployees.length === 0) {
      setBonusMessage("Masukkan jumlah produk terjual yang valid dan pastikan ada karyawan penerima bonus.");
      return;
    }
    const totalBonus = productCount * 500;
    const baseShare = Math.floor(totalBonus / activeEmployees.length);
    let remainder = totalBonus - baseShare * activeEmployees.length;
    const batchId = crypto.randomUUID();
    additions = activeEmployees.map((employee) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return {
        id: crypto.randomUUID(), batchId, type: "target",
        typeLabel: "Bonus Target Penjualan",
        employeeName: employee.name, amount: baseShare + extra,
        productCount, unitRate: 500,
        description: `${productCount} produk terjual × Rp500`,
        period, createdAt: now, createdBy: "Administrator",
      };
    });
  }

  if (bonusType === "menu") {
    const foodCount = Math.floor(Number(bonusForm.foodCount) || 0);
    const drinkCount = Math.floor(Number(bonusForm.drinkCount) || 0);
    const chef = employees.find((employee) => employee.position.toUpperCase().includes("HEAD CHEF"));
    const barista = employees.find((employee) => employee.position.toUpperCase().includes("SENIOR BARISTA"));
    if (foodCount < 0 || drinkCount < 0 || (foodCount === 0 && drinkCount === 0)) {
      setBonusMessage("Masukkan jumlah menu makanan atau minuman minimal satu.");
      return;
    }
    if (foodCount > 0 && !chef) {
      setBonusMessage("Data karyawan dengan jabatan HEAD CHEF belum ditemukan.");
      return;
    }
    if (drinkCount > 0 && !barista) {
      setBonusMessage("Data karyawan dengan jabatan SENIOR BARISTA belum ditemukan.");
      return;
    }
    if (foodCount > 0) additions.push({
      id: crypto.randomUUID(), type: "menu-food", typeLabel: "Bonus Pembuatan Menu Makanan",
      employeeName: chef.name, quantity: foodCount, unitRate: 7000,
      amount: foodCount * 7000, description: `${foodCount} menu makanan × Rp7.000`,
      period, createdAt: now, createdBy: "Administrator",
    });
    if (drinkCount > 0) additions.push({
      id: crypto.randomUUID(), type: "menu-drink", typeLabel: "Bonus Pembuatan Menu Minuman",
      employeeName: barista.name, quantity: drinkCount, unitRate: 5000,
      amount: drinkCount * 5000, description: `${drinkCount} menu minuman × Rp5.000`,
      period, createdAt: now, createdBy: "Administrator",
    });
  }



  if (additions.length) {
    setBonusRecords((current) => [...additions, ...current]);
    setBonusMessage(
      bonusType === "reservation"
        ? `Bonus reservasi ${money(Math.round(Number(bonusForm.transactionValue) * 0.05))} berhasil dibagi kepada ${additions.length} karyawan aktif (Mbah No tidak termasuk).`
        : "Bonus berhasil dicatat dan masuk ke perhitungan payroll periode " + month + "."
    );
    resetBonusForm();
  }
};


const handleDeleteBonus = (recordId) => {
  const record = bonusRecords.find((item) => item.id === recordId);
  if (!record) return;
  const confirmation = record.batchId
    ? "Hapus transaksi bonus ini beserta pembagian bonus seluruh karyawan?"
    : "Hapus catatan bonus ini? Perubahan akan memengaruhi payroll periode terkait.";
  if (!window.confirm(confirmation)) return;
  setBonusRecords((current) => current.filter((item) =>
    record.batchId ? item.batchId !== record.batchId : item.id !== recordId
  ));
  setBonusMessage(record.batchId
    ? "Transaksi bonus dan seluruh pembagian bonus berhasil dihapus."
    : "Catatan bonus dihapus.");
};

const totalBonusPeriod = bonusPeriodRecords.reduce((sum, record) => sum + Number(record.amount || 0), 0);
const reservationBonusPeriodTotal = bonusPeriodRecords
  .filter((record) => record.type === "reservation")
  .reduce((sum, record) => sum + Number(record.amount || 0), 0);
const reservationEligibleEmployees = employees.filter((employee) =>
  employee.status !== "nonaktif" && employee.name.trim().toUpperCase() !== "MBAH NO"
);
const reservationEntriesForPeriod = reservationEntries.filter((entry) => entry.period === month);
const pendingReservationEntries = reservationEntriesForPeriod.filter((entry) => !entry.processedAt);
const pendingReservationTransactionTotal = pendingReservationEntries.reduce(
  (sum, entry) => sum + Number(entry.transactionValue || 0), 0
);
const pendingReservationBonusTotal = pendingReservationEntries.reduce(
  (sum, entry) => sum + Math.round(Number(entry.transactionValue || 0) * 0.05), 0
);
const reservationAccumulatedAverage = reservationEligibleEmployees.length
  ? Math.floor(pendingReservationBonusTotal / reservationEligibleEmployees.length)
  : 0;


const payrollData = useMemo(
  () => employees.map((employee) => ({
    ...employee,
    bonDeduction: monthlyBonDeductionByEmployee[employee.name] || 0,
    bonusPeriod: bonusByEmployee[employee.name] || 0,
    ...calculate({ ...employee, bonDeduction: monthlyBonDeductionByEmployee[employee.name] || 0, bonus: (bonusByEmployee[employee.name] || 0) })
  })),
  [employees, monthlyBonDeductionByEmployee, bonusByEmployee]
);
 

  const totals = useMemo(
    () =>
      payrollData.reduce(
        (result, employee) => ({
          salary: result.salary + employee.salary,
          payroll: result.payroll + employee.totalPayroll,
          overtime: result.overtime + employee.overtimePay,
          bon: result.bon + employee.remainingBon,
        }),
        { salary: 0, payroll: 0, overtime: 0 }
      ),
    [payrollData]
  );

  const filteredEmployees = payrollData.filter((employee) =>
    `${employee.name} ${employee.position}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const menu = [
{
  section: "MENU UTAMA",
  items: [
    { name: "Dashboard", icon: "▦" },
    { name: "Data Karyawan", icon: "♙" },
    { name: "Import Absensi", icon: "▧" },
    { name: "Penggajian", icon: "▤" }
  ]
},    { section: "KEUANGAN", items: [{ name: "Bon Karyawan", icon: "⇄" }, { name: "Bonus & Penjualan", icon: "✦" }, { name: "Pembayaran", icon: "▣" }] },
    { section: "LAPORAN", items: [{ name: "Laporan Gaji", icon: "▥" }, { name: "Pengaturan", icon: "⚙" }] },
  ];


const handlePrintAttendanceErrors = () => {
  if (attendanceErrors.length === 0) return;

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    alert("Izinkan pop-up browser untuk mencetak laporan.");
    return;
  }

  const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);

  const rows = attendanceErrors.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.rowNumber}</td>
      <td>${escapeHTML(item.date)}</td>
      <td>${escapeHTML(item.name)}</td>
      <td>${escapeHTML(item.workHours)}</td>
      <td>${escapeHTML(item.reason)}</td>
    </tr>
  `).join("");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Laporan Error Absensi</title>
      <style>
        body { font-family: Arial; padding: 25px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #999; padding: 8px; }
      </style>
    </head>
    <body>
      <h2>RESTO & CAFE SISI DANAU</h2>
      <h3>LAPORAN ERROR IMPORT ABSENSI</h3>
      <p>Total baris bermasalah: ${attendanceErrors.length}</p>
      <table>
        <thead>
          <tr>
            <th>No.</th>
            <th>Baris Excel</th>
            <th>Tanggal</th>
            <th>Nama Karyawan</th>
            <th>Durasi Kerja</th>
            <th>Keterangan Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `);

  printWindow.document.close();
};

const handleExportPayroll = () => {
  const exportData = payrollData.map((employee, index) => ({
    "NO": index + 1,
    "NAMA KARYAWAN": employee.name,
    "POSISI": employee.position,
    "GAJI POKOK": employee.salary,
    "LEMBUR (JAM)": employee.overtime,
    "UANG LEMBUR": Math.round(employee.overtimePay),
    "BONUS PERIODE": Math.round(employee.bonusPeriod || 0),
    "CICILAN BON": Math.round(employee.bonDeduction || 0),
    "GAJI BERSIH": Math.round(employee.totalPayroll),
  }));

  exportData.push({
    "NO": "",
    "NAMA KARYAWAN": "TOTAL",
    "POSISI": "",
    "GAJI POKOK": totals.salary,
    "LEMBUR (JAM)": employees.reduce(
      (sum, employee) => sum + Number(employee.overtime || 0),
      0
    ),
    "UANG LEMBUR": Math.round(totals.overtime),
    "BONUS PERIODE": Math.round(payrollData.reduce((sum, employee) => sum + (employee.bonusPeriod || 0), 0)),
    "CICILAN BON": Math.round(payrollData.reduce((sum, employee) => sum + employee.bonDeduction, 0)),
    "GAJI BERSIH": Math.round(payrollData.reduce((sum, employee) => sum + employee.totalPayroll, 0)),
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Penggajian"
  );

  XLSX.writeFile(
    workbook,
    `Laporan_Penggajian_${month.replace(" ", "_")}.xlsx`
  );
};

const handlePrintPayslip = (employee) => {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Izinkan pop-up browser untuk mencetak slip gaji.");
    return;
  }
  const employeeBonusRecords = bonusPeriodRecords.filter((record) => record.employeeName === employee.name);
  const isMenuBonusRecipient = ["HEAD CHEF", "SENIOR BARISTA"].includes(String(employee.position || "").trim().toUpperCase());
  const bonusTarget = employeeBonusRecords.filter((record) => record.type === "target").reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const bonusMenu = employeeBonusRecords.filter((record) => record.type === "menu-food" || record.type === "menu-drink")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const bonusReservation = employeeBonusRecords.filter((record) => record.type === "reservation")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  printWindow.document.write(`<!DOCTYPE html>
  <html><head><meta charset="UTF-8" />
  <title>Slip Gaji - ${escapeHTML(employee.name)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#172033;padding:32px}
    .slip{max-width:720px;margin:0 auto;border:1px solid #d8deea;padding:28px}
    h1{margin:0;font-size:21px}.sub{color:#667085;margin:6px 0 22px;font-size:12px}
    .meta{display:flex;justify-content:space-between;gap:20px;margin:18px 0}
    table{width:100%;border-collapse:collapse;margin-top:18px}
    td{padding:11px 8px;border-bottom:1px solid #e5e9f0}
    td:last-child{text-align:right;font-weight:600}
    .total td{border-top:2px solid #172033;border-bottom:0;font-size:17px;font-weight:700}
    .foot{margin-top:42px;display:flex;justify-content:space-between;font-size:12px;color:#667085}
    @media print{body{padding:0}.slip{border:0}}
  </style></head><body><main class="slip">
    <h1>RESTO &amp; CAFE SISI DANAU</h1>
    <div class="sub">SLIP GAJI KARYAWAN · PERIODE ${escapeHTML(month)}</div>
    <div class="meta"><div><b>Nama</b><br/>${escapeHTML(employee.name)}</div>
    <div><b>Posisi</b><br/>${escapeHTML(employee.position)}</div></div>
    <table>
      <tr><td>Gaji pokok</td><td>${money(employee.salary)}</td></tr>
      <tr><td>Uang lembur</td><td>${money(employee.overtimePay)}</td></tr>
      <tr><td>Bon / potongan cicilan periode</td><td>-${money(Number(employee.bonDeduction || 0))}</td></tr>
      <tr><td>Bonus target</td><td>${money(bonusTarget)}</td></tr>
      ${isMenuBonusRecipient ? `<tr><td>Bonus menu</td><td>${money(bonusMenu)}</td></tr>` : ""}
      <tr><td>Bonus reservasi</td><td>${money(bonusReservation)}</td></tr>
      <tr class="total"><td>GAJI BERSIH</td><td>${money(employee.totalPayroll)}</td></tr>
    </table>
    <div class="foot"><span>Tanggal cetak: ${new Date().toLocaleDateString("id-ID")}</span><span>Administrator</span></div>
  </main><script>window.onload=()=>window.print();</script></body></html>`);
  printWindow.document.close();
};

const handleExportPayslips = () => {
  const rows = payrollData.map((employee, index) => ({
    "NO": index + 1, "NAMA KARYAWAN": employee.name, "POSISI": employee.position,
    "GAJI POKOK": Math.round(employee.salary || 0),
    "UANG LEMBUR": Math.round(employee.overtimePay || 0),
    "BON / TOTAL POTONGAN": Math.round(Number(employee.bonDeduction || 0)),
    "BONUS TARGET": Math.round(bonusPeriodRecords.filter((record) => record.employeeName === employee.name && record.type === "target")
        .reduce((sum, record) => sum + Number(record.amount || 0), 0)),
    "BONUS MENU": ["HEAD CHEF", "SENIOR BARISTA"].includes(String(employee.position || "").trim().toUpperCase())
      ? Math.round(bonusPeriodRecords.filter((record) => record.employeeName === employee.name && (record.type === "menu-food" || record.type === "menu-drink"))
          .reduce((sum, record) => sum + Number(record.amount || 0), 0)) : 0,
    "BONUS RESERVASI": Math.round(bonusPeriodRecords.filter((record) => record.employeeName === employee.name && record.type === "reservation")
      .reduce((sum, record) => sum + Number(record.amount || 0), 0)),
    "GAJI BERSIH": Math.round(employee.totalPayroll || 0),
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Slip Gaji");
  XLSX.writeFile(workbook, `Slip_Gaji_${month.replaceAll(" ", "_")}.xlsx`);
};



const handleWhatsAppPayslip = (employee) => {
  const rawPhone = String(employee.phone || "").trim();
  let phone = rawPhone.replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  else if (phone.startsWith("8")) phone = `62${phone}`;

  if (!phone) {
    alert(`Nomor WhatsApp ${employee.name} belum diisi. Lengkapi melalui menu Data Karyawan > Edit Karyawan.`);
    return;
  }
  if (phone.length < 10 || phone.length > 15) {
    alert(`Nomor WhatsApp ${employee.name} tidak valid. Gunakan format 08xxxxxxxxxx atau 62xxxxxxxxxx.`);
    return;
  }

  const records = bonusPeriodRecords.filter((record) => record.employeeName === employee.name);
  const bonusTarget = records.filter((record) => record.type === "target")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const bonusMenu = records.filter((record) => record.type === "menu-food" || record.type === "menu-drink")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const bonusReservation = records.filter((record) => record.type === "reservation")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const isMenuBonusRecipient = ["HEAD CHEF", "SENIOR BARISTA"].includes(String(employee.position || "").trim().toUpperCase());

  const message = [
    `Yth. ${employee.name},`,
    "",
    `Berikut rincian slip gaji RESTO & CAFE SISI DANAU periode ${month}:`,
    `Nama: ${employee.name}`,
    `Posisi: ${employee.position}`,
    `Gaji pokok: ${money(employee.salary)}`,
    `Uang lembur: ${money(employee.overtimePay)}`,
    `Bon / potongan: ${money(employee.bonDeduction || 0)}`,
    `Bonus target: ${money(bonusTarget)}`,
    ...(isMenuBonusRecipient ? [`Bonus menu: ${money(bonusMenu)}`] : []),
    `Bonus reservasi: ${money(bonusReservation)}`,
    "",
    `GAJI BERSIH: ${money(employee.totalPayroll)}`,
    "",
    "Mohon periksa rincian tersebut. Terima kasih."
  ].join("\n");

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
};


const salaryReportRows = payrollData.map((employee, index) => {
  const records = bonusPeriodRecords.filter((record) => record.employeeName === employee.name);
  const bonusTarget = records.filter((record) => record.type === "target")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const bonusMenu = ["HEAD CHEF", "SENIOR BARISTA"].includes(String(employee.position || "").trim().toUpperCase())
    ? records.filter((record) => record.type === "menu-food" || record.type === "menu-drink")
        .reduce((sum, record) => sum + Number(record.amount || 0), 0)
    : 0;
  const bonusReservation = records.filter((record) => record.type === "reservation")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const totalBonus = bonusTarget + bonusMenu + bonusReservation;
  const gross = Number(employee.salary || 0) + Number(employee.overtimePay || 0) + totalBonus;
  return {
    no: index + 1,
    ...employee,
    bonusTarget,
    bonusMenu,
    bonusReservation,
    totalBonus,
    gross,
    net: gross - Number(employee.bonDeduction || 0),
  };
});

const salaryReportTotals = salaryReportRows.reduce((sum, row) => ({
  salary: sum.salary + Number(row.salary || 0),
  overtime: sum.overtime + Number(row.overtimePay || 0),
  bon: sum.bon + Number(row.bonDeduction || 0),
  bonusTarget: sum.bonusTarget + row.bonusTarget,
  bonusMenu: sum.bonusMenu + row.bonusMenu,
  bonusReservation: sum.bonusReservation + row.bonusReservation,
  bonuses: sum.bonuses + row.totalBonus,
  gross: sum.gross + row.gross,
  net: sum.net + row.net,
}), {
  salary: 0, overtime: 0, bon: 0, bonusTarget: 0, bonusMenu: 0,
  bonusReservation: 0, bonuses: 0, gross: 0, net: 0,
});

const activeSalaryArchive = salaryReportArchives.find((item) => item.period === selectedSalaryArchive);
const displayedSalaryReportRows = activeSalaryArchive?.rows || salaryReportRows;
const displayedSalaryReportTotals = activeSalaryArchive?.totals || salaryReportTotals;
const displayedSalaryReportPeriod = activeSalaryArchive?.period || month;
const filteredSalaryReportRows = displayedSalaryReportRows.filter((row) =>
  `${row.name} ${row.position}`.toLowerCase().includes(search.toLowerCase())
);

const handleSaveSalaryArchive = () => {
  const existing = salaryReportArchives.find((item) => item.period === month);
  if (existing && !window.confirm(`Arsip laporan ${month} sudah ada. Ganti dengan perhitungan terbaru?`)) return;
  const snapshot = {
    period: month,
    savedAt: new Date().toISOString(),
    rows: salaryReportRows.map((row) => ({ ...row })),
    totals: { ...salaryReportTotals },
  };
  setSalaryReportArchives((current) => [snapshot, ...current.filter((item) => item.period !== month)]
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)));
  setSelectedSalaryArchive(month);
  setSalaryArchiveMessage(`Laporan ${month} berhasil disimpan sebagai arsip.`);
};

const handleDeleteSalaryArchive = () => {
  if (!activeSalaryArchive) return;
  if (!window.confirm(`Hapus arsip laporan ${activeSalaryArchive.period}? Data arsip yang dihapus tidak dapat dipulihkan.`)) return;
  setSalaryReportArchives((current) => current.filter((item) => item.period !== selectedSalaryArchive));
  setSelectedSalaryArchive("");
  setSalaryArchiveMessage("Arsip laporan berhasil dihapus.");
};

const handleExportSalaryReport = () => {
  const rows = displayedSalaryReportRows.map((row) => ({
    "NO": row.no,
    "NAMA KARYAWAN": row.name,
    "POSISI": row.position,
    "GAJI POKOK": Math.round(row.salary),
    "UANG LEMBUR": Math.round(row.overtimePay),
    "BON": Math.round(row.bonDeduction),
    "BONUS TARGET": Math.round(row.bonusTarget),
    "BONUS MENU": Math.round(row.bonusMenu),
    "BONUS RESERVASI": Math.round(row.bonusReservation),
    "PENGHASILAN KOTOR": Math.round(row.gross),
    "GAJI BERSIH": Math.round(row.net),
  }));
  rows.push({
    "NO": "", "NAMA KARYAWAN": "TOTAL", "POSISI": "",
    "GAJI POKOK": Math.round(displayedSalaryReportTotals.salary),
    "UANG LEMBUR": Math.round(displayedSalaryReportTotals.overtime),
    "BON": Math.round(displayedSalaryReportTotals.bon),
    "BONUS TARGET": Math.round(displayedSalaryReportTotals.bonusTarget),
    "BONUS MENU": Math.round(displayedSalaryReportTotals.bonusMenu),
    "BONUS RESERVASI": Math.round(displayedSalaryReportTotals.bonusReservation),
    "PENGHASILAN KOTOR": Math.round(displayedSalaryReportTotals.gross),
    "GAJI BERSIH": Math.round(displayedSalaryReportTotals.net),
  });
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Gaji");
  XLSX.writeFile(workbook, `Laporan_Gaji_${displayedSalaryReportPeriod.replaceAll(" ", "_")}.xlsx`);
};

const handlePrintSalaryReport = () => {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Izinkan pop-up browser untuk mencetak laporan gaji.");
    return;
  }
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const rows = displayedSalaryReportRows.map((row) => `
    <tr>
      <td>${row.no}</td><td>${safe(row.name)}</td><td>${safe(row.position)}</td>
      <td>${money(row.salary)}</td><td>${money(row.overtimePay)}</td>
      <td>${money(row.bonDeduction)}</td><td>${money(row.totalBonus)}</td>
      <td>${money(row.gross)}</td><td><b>${money(row.net)}</b></td>
    </tr>`).join("");
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Laporan Gaji ${safe(displayedSalaryReportPeriod)}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#172033}h1{font-size:22px}p{color:#667085}
    table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #d8deea;padding:8px;text-align:left}
    th{background:#f2f5fa}td:nth-child(n+4){text-align:right}.total{font-weight:bold;background:#f7f9fc}</style>
    </head><body><h1>RESTO &amp; CAFE SISI DANAU</h1><h2>LAPORAN GAJI</h2><p>Periode ${safe(displayedSalaryReportPeriod)}</p>
    <table><thead><tr><th>No</th><th>Nama</th><th>Posisi</th><th>Gaji Pokok</th><th>Lembur</th><th>Bon</th><th>Bonus</th><th>Kotor</th><th>Bersih</th></tr></thead>
    <tbody>${rows}<tr class="total"><td></td><td colspan="2">TOTAL</td><td>${money(displayedSalaryReportTotals.salary)}</td>
    <td>${money(displayedSalaryReportTotals.overtime)}</td><td>${money(displayedSalaryReportTotals.bon)}</td>
    <td>${money(displayedSalaryReportTotals.bonuses)}</td><td>${money(displayedSalaryReportTotals.gross)}</td><td>${money(displayedSalaryReportTotals.net)}</td></tr></tbody></table>
    <script>window.onload=()=>window.print();</script></body></html>`);
  printWindow.document.close();
};


  if (authLoading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3f7fc", color: "#1b2d45", fontFamily: "Inter, Arial, sans-serif" }}>Memeriksa sesi login...</div>;
  }

  if (!session) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "linear-gradient(135deg,#eaf2fb,#f7faff)", fontFamily: "Inter, Arial, sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 430, background: "#fff", border: "1px solid #dce6f2", borderRadius: 22, padding: 32, boxShadow: "0 24px 70px rgba(24,57,94,.14)" }}>
          <div style={{ width: 52, height: 52, display: "grid", placeItems: "center", borderRadius: 15, background: "#1769bd", color: "white", fontWeight: 800, letterSpacing: 1, marginBottom: 22 }}>SD</div>
          <div style={{ color: "#2675c8", fontSize: 11, fontWeight: 800, letterSpacing: 2 }}>SISI DANAU · PAYROLL</div>
          <h1 style={{ color: "#172b45", fontSize: 27, margin: "8px 0" }}>Login Administrator</h1>
          <p style={{ color: "#718096", margin: "0 0 24px", lineHeight: 1.5 }}>Masuk menggunakan akun yang sudah didaftarkan oleh owner. Pendaftaran publik dinonaktifkan.</p>
          <form onSubmit={handleLogin} style={{ display: "grid", gap: 13 }}>
            <label style={{ color: "#43566e", fontSize: 13, fontWeight: 700 }}>Email</label>
            <input type="email" autoComplete="username" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="admin@contoh.com" style={{ width: "100%", boxSizing: "border-box", padding: "14px 15px", border: "1px solid #d5e0ed", borderRadius: 11, fontSize: 15, color: "#20334c", background: "#fff" }} />
            <label style={{ color: "#43566e", fontSize: 13, fontWeight: 700 }}>Password</label>
            <input type="password" autoComplete="current-password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Masukkan password" style={{ width: "100%", boxSizing: "border-box", padding: "14px 15px", border: "1px solid #d5e0ed", borderRadius: 11, fontSize: 15, color: "#20334c", background: "#fff" }} />
            {authError && <div role="alert" style={{ padding: 12, borderRadius: 10, background: "#fff1f0", color: "#b42318", fontSize: 13 }}>{authError}</div>}
            <button type="submit" disabled={authBusy} style={{ marginTop: 8, padding: 15, border: 0, borderRadius: 11, background: authBusy ? "#8ab5df" : "#1769bd", color: "white", fontWeight: 800, fontSize: 15, cursor: authBusy ? "wait" : "pointer" }}>{authBusy ? "Memproses..." : "Masuk ke Dashboard"}</button>
          </form>
          <div style={{ marginTop: 20, color: "#8795a7", fontSize: 11, lineHeight: 1.5 }}>Akses dilindungi Supabase Authentication dan Row Level Security.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SD</div>
          <div>
            <h2>SISI DANAU</h2>
            <span>PAYROLL MANAGEMENT</span>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>
        {menu.map((group) => (
          <div className="menu-group" key={group.section}>
            <div className="menu-heading">{group.section}</div>
            {group.items.map((item) => (
              <button
                key={item.name}
                className={`menu-item ${activePage === item.name ? "active" : ""}`}
                onClick={() => setActivePage(item.name)}
              >
                <span className="menu-icon">{item.icon}</span>
                {item.name}
                {activePage === item.name && <span className="active-dot" />}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-bottom">
          <div className="user-avatar">{(staffProfile?.full_name || session.user.email || "AD").slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{staffProfile?.full_name || session.user.email}</strong>
            <span>{String(staffProfile?.role || "user").toUpperCase()}</span>
          </div>
          <button type="button" onClick={handleLogout} title="Keluar" aria-label="Keluar" style={{ marginLeft: "auto", border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12 }}>Keluar</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Sisi Danau <span>/</span> {activePage}</div>
          <div className="topbar-right">
            <span className="system-status"><i /> Sistem aktif</span>
            <div className="top-avatar">AD</div>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">PAYROLL MANAGEMENT SYSTEM</div>
              <h1>{activePage}</h1>
              <p>Kelola penggajian dan administrasi karyawan Resto & Cafe Sisi Danau.</p>
            </div>
            <div className="period-control">
              <label>PERIODE PENGGAJIAN</label>
              <select value={month} onChange={(event) => setMonth(event.target.value)}>
                <option>November 2026</option>
                <option>Oktober 2026</option>
                <option>September 2026</option>
                <option>Agustus 2026</option>
              </select>
            </div>
          </div>

          {activePage === "Dashboard" && (
            <>
              <div className="welcome-panel">
                <div>
                  <span className="welcome-tag">RINGKASAN BULANAN</span>
                  <h2>Payroll Overview</h2>
                  <p>Pantau data penggajian dan status administrasi karyawan.</p>
                </div>
                <div className="welcome-art">SD</div>
              </div>

              <div className="stats-grid">
                <StatCard icon="♙" label="TOTAL KARYAWAN" value="13 Orang" note="Data karyawan Excel" />
                <StatCard icon="▤" label="TOTAL GAJI POKOK" value={money(totals.salary)} note="Sebelum lembur dan potongan" />
                <StatCard icon="↗" label="TOTAL UANG LEMBUR" value={money(totals.overtime)} note="Perhitungan 1/173 × gaji × jam" />
                <StatCard icon="◎" label="TOTAL PENGGAJIAN" value={money(totals.payroll)} note="Sebelum penambahan penjualan" />
              </div>

              <div className="content-grid">
                <section className="panel employee-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Data Karyawan</h3>
                      <p>Daftar karyawan dan posisi kerja</p>
                    </div>
                    <button className="text-button" onClick={() => setActivePage("Data Karyawan")}>Lihat semua →</button>
                  </div>

<div className="excel-import-toolbar">
  <div>
    <strong>Import Data Penggajian</strong>
    <p>Masukkan data karyawan dari file Excel.</p>
  </div>

  <div>
    <input
      ref={excelInputRef}
      type="file"
      accept=".xlsx,.xls"
      onChange={handleImportExcel}
      hidden
    />

    <button
      className="primary-button"
      type="button"
      onClick={() => excelInputRef.current?.click()}
    >
      ⇧ Import Excel
    </button>
  </div>
</div>

{importMessage && (
  <div className="import-message">
    {importMessage}
  </div>
)}

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>NAMA KARYAWAN</th><th>POSISI</th><th>GAJI POKOK</th><th>LEMBUR</th></tr>
                      </thead>
                      <tbody>
                        {payrollData.slice(0, 6).map((employee) => (
                          <tr key={employee.id || employee.name}>
                            <td><strong>{employee.name}</strong></td>
                            <td><span className="position-tag">{employee.position}</span></td>
                            <td>{money(employee.salary)}</td>
                            <td>{employee.overtime} jam</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="panel summary-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Ringkasan Keuangan</h3>
                      <p>Periode {month}</p>
                    </div>
                    <span className="summary-icon">◈</span>
                  </div>
                  <div className="summary-line">
                    <span>Total gaji pokok</span><strong>{money(totals.salary)}</strong>
                  </div>
                  <div className="summary-line">
                    <span>Total lembur</span><strong>{money(totals.overtime)}</strong>
                  </div>
                  <div className="summary-line">
                    <span>Sisa bon karyawan</span><strong>{money(totalBonRemaining)}</strong>
                  </div>
                  <div className="summary-total">
                    <span>Total payroll</span>
                    <strong>{money(totals.payroll)}</strong>
                  </div>
                  <div className="summary-footnote">* Angka awal dihitung dari data contoh Excel.</div>
                </section>
              </div>
            </>
          )}

          {activePage === "Data Karyawan" && (
            <section className="panel full-panel">
              <div className="panel-heading employee-list-heading">
                <div><h3>Data Karyawan</h3><p>Kelola identitas, jabatan, nomor WhatsApp, dan gaji pokok karyawan.</p></div>
                <span className="count-badge">{employees.length} Karyawan</span>
              </div>
              <div className="search-row">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau posisi karyawan..." />
                <button
  className="primary-button"
  type="button"
  onClick={() => {
    setFormError("");
    setShowAddEmployee(true);
  }}
>
  + Tambah Karyawan
</button>
              </div>
              <div className="table-wrap">
                <table className="employee-table">
                  <thead>
                    <tr>
                      <th>No.</th>
                      <th>Nama Karyawan</th>
                      <th>Jabatan</th>
                      <th>Gaji Pokok</th>
                      <th>Status</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((employee, index) => (
                      <tr key={employee.id || employee.name}>
                        <td>{index + 1}</td><td><strong>{employee.name}</strong></td>
                        <td>{employee.position}</td><td>{money(employee.salary)}</td>
                        <td><span className="status-active">{employee.status === "nonaktif" ? "Nonaktif" : "Aktif"}</span></td>
                        <td>
  <div className="action-buttons employee-actions">
<button
  type="button"
  className="icon-action edit-icon"
  title="Edit Karyawan"
  aria-label="Edit Karyawan"
  onClick={() =>
    setEditingEmployee({
      ...employee,
      originalName: employee.name,
    })
  }
>
  <svg viewBox="0 0 24 24">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
  </svg>
</button>


  <button
    type="button"
    className="icon-action delete-icon delete-button"
    title={`Hapus ${employee.name}`}
    aria-label={`Hapus ${employee.name}`}
    onClick={() => handleDeleteEmployee(employee)}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  </button>
  </div>
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredEmployees.length === 0 && <div className="empty-state">Karyawan tidak ditemukan.</div>}
                

    
      
       

    
      
  

              </div>
            </section>
          )}

          

{activePage === "Penggajian" && (
  <section className="panel full-panel">
    <div className="panel-heading">
      <div>
        <h3>Daftar Penggajian Karyawan</h3>
        <p>Periode {month} · Data otomatis dari Data Karyawan</p>
      </div>
      <span className="count-badge">
        {payrollData.length} Karyawan
      </span>
         </div>

      {/* TOOLBAR IMPORT EXCEL */}
      

<div className="excel-import-toolbar">
  <button
    className="primary-button import-button"
    type="button"
    onClick={handleExportPayroll}
  >
    ⇩ Export Excel
  </button>
</div>


      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>NO.</th>
            <th>NAMA KARYAWAN</th>
            <th>POSISI</th>
            <th>GAJI POKOK</th>
            <th>LEMBUR</th>
            <th>UANG LEMBUR</th>
            <th>BONUS</th>
            <th>CICILAN BON</th>
            <th>GAJI BERSIH</th>
          </tr>
        </thead>

        <tbody>
          {payrollData.map((employee, index) => (
            <tr key={employee.id || employee.name}>
              <td>{index + 1}</td>

              <td>
                <strong>{employee.name}</strong>
              </td>

              <td>{employee.position}</td>

              <td>{money(employee.salary)}</td>

              <td>
                <input
                  className="overtime-input"
                  type="number"
                  min="0"
                  step="1"
                  value={Math.floor(employee.overtime)}
                  onChange={(event) => {
                    const value = Math.max(
                      0,
                      Number(event.target.value) || 0
                    );

                    setEmployees((current) =>
                      current.map((item) =>
                        item.name === employee.name
                          ? { ...item, overtime: value }
                          : item
                      )
                    );
                  }}
                />
              </td>

              <td>
                {money(employee.overtimePay)}
              </td>
              <td>{money(employee.bonusPeriod || 0)}</td>
              <td>{money(Number(employee.bonDeduction || 0))}</td>
              <td>
                <strong>{money(employee.totalPayroll)}</strong>
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <th colSpan="3">TOTAL</th>
            <th>{money(totals.salary)}</th>
            <th>
              {Math.floor(
  employees.reduce(
    (sum, employee) => sum + Number(employee.overtime || 0),
    0
  )
)}
            </th>
            <th>{money(totals.overtime)}</th>
            <th>{money(payrollData.reduce((sum, employee) => sum + (employee.bonusPeriod || 0), 0))}</th>
            <th>{money(payrollData.reduce((sum, employee) => sum + employee.bonDeduction, 0))}</th>
            <th>{money(payrollData.reduce((sum, employee) => sum + employee.totalPayroll, 0))}</th>
          </tr>
        </tfoot>
      </table>
    </div>

    <div className="payroll-note">
      Jam lembur dapat diubah langsung pada tabel.
      Uang lembur dihitung otomatis menggunakan rumus
      Gaji Pokok ÷ 173 × Jam Lembur.
      Cicilan bon otomatis mengurangi gaji bersih. Potongan periode ini: {money(payrollData.reduce((sum, employee) => sum + employee.bonDeduction, 0))}.
    </div>
    
  </section>
)}


{activePage === "Import Absensi" && (
  <section className="panel full-panel">
    <div className="panel-heading">
      <div>
        <h3>Import Laporan Absensi</h3>
        <p>Upload laporan absensi bulanan untuk menghitung lembur otomatis.</p>
      </div>
      <span className="count-badge">
        {attendanceSummary.length} Karyawan
      </span>
    </div>

    <div className="excel-import-toolbar">
      <div>
        <strong>Upload File Absensi</strong>
        <p>Format Excel .xlsx atau .xls</p>
      </div>

      <input
        ref={attendanceInputRef}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={handleImportAttendance}
      />

      <button
        className="primary-button import-button"
        type="button"
        onClick={() => attendanceInputRef.current?.click()}
      >
        ⇧ Import Absensi
      </button>
    </div>

    {attendanceMessage && (
  <div className="import-message">
    {attendanceMessage}
  </div>
)}

{attendanceErrors.length > 0 && (
  <div style={{
    marginTop: 12,
    padding: 14,
    background: "#fff4e5",
    border: "1px solid #f5c27a",
    borderRadius: 8,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12
  }}>
    <div>
      <strong>{attendanceErrors.length} Baris Bermasalah</strong>
      <p style={{ margin: "4px 0 0", fontSize: 13 }}>
        Periksa laporan error sebelum memperbaiki file Excel.
      </p>
    </div>

    <button
      className="primary-button"
      type="button"
      onClick={handlePrintAttendanceErrors}
    >
      Cetak Laporan Error
    </button>
  </div>
)}

    
{attendanceSummary.length > 0 && (
  <>
    <h3>Rekap Absensi Harian</h3>

    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>TANGGAL</th>
            <th>NAMA KARYAWAN</th>
            <th>JAM KERJA</th>
            <th>LEMBUR</th>
          </tr>
        </thead>
        <tbody>
          {attendanceDailyRecords.map((record, index) => (
            <tr key={`${record.name}-${record.date}-${index}`}>
              <td>{record.date}</td>
              <td><strong>{record.name}</strong></td>
              <td>{formatHoursMinutes(record.workMinutes)}</td>
              <td>
                <strong>
                  {formatHoursMinutes(record.overtimeMinutes)}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <h3 style={{ marginTop: 28 }}>
  Total Lembur Bulanan per Karyawan
</h3>

<div className="table-wrap">
  <table>
    <thead>
      <tr>
        <th>NO</th>
        <th>NAMA KARYAWAN</th>
        <th>TOTAL JAM</th>
        <th>TOTAL MENIT</th>
        <th>MENIT ÷ 60</th>
        <th>TOTAL LEMBUR</th>
      </tr>
    </thead>

    <tbody>
      {attendanceSummary.map((employee, index) => {
        const tambahanJam = Math.floor(
          employee.totalOvertimeRemainderMinutes / 60
        );

        const totalJam =
          employee.totalOvertimeHours + tambahanJam;

        const totalMenit =
          employee.totalOvertimeRemainderMinutes;

        return (
          <tr key={employee.id || employee.name}>
            <td>{index + 1}</td>
            <td><strong>{employee.name}</strong></td>
            <td>{employee.totalOvertimeHours} jam</td>
            <td>{totalMenit} menit</td>
            <td>{tambahanJam} jam</td>
            <td>
  <strong>
    {Math.floor(employee.totalOvertimeMinutes / 60)} jam
  </strong>
</td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>

    <button
      className="primary-button"
      type="button"
      onClick={() => {
        setEmployees((current) =>
          current.map((employee) => {
            const result = attendanceSummary.find(
              (item) => item.name === employee.name
            );

            return result
              ? {
                  ...employee,
                  overtime: Math.floor(result.totalOvertimeMinutes / 60),
                }
              : employee;
          })
        );

        setAttendanceMessage(
          "Total lembur berhasil diterapkan ke Penggajian."
        );
      }}
    >
      Terapkan Total Lembur ke Penggajian
    </button>
  </>
)}

  
  </section>
)}

{activePage === "Bon Karyawan" && (
  <section className="bon-page">

    {/* RINGKASAN BON */}
    <div className="bon-summary">

      <div className="bon-card">
        <span>Total Catatan Bon</span>
        <strong>{bonRecords.length}</strong>
      </div>

      <div className="bon-card">
        <span>Total Bon Tercatat</span>
        <strong>{money(totalBonApproved)}</strong>
      </div>

      <div className="bon-card">
        <span>Total Sudah Dipotong</span>
        <strong>{money(totalBonPaid)}</strong>
      </div>

      <div className="bon-card">
        <span>Total Sisa Bon</span>
        <strong>{money(totalBonRemaining)}</strong>
      </div>

    </div>

    <section className="panel full-panel">

      <div className="panel-heading">
        <div>
          <h3>Manajemen Bon Karyawan</h3>
          <p>Pencatatan langsung oleh admin dan potongan gaji otomatis setiap bulan</p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setBonMessage("");
            setShowBonForm(true);
          }}
        >
          + Catat Bon
        </button>
      </div>

      {bonMessage && (
        <div className="import-message">
          {bonMessage}
        </div>
      )}

      {/* FORM PENGAJUAN */}
      {showBonForm && (
        <form
          className="bon-form"
          onSubmit={handleSubmitBon}
        >
          <h3>Form Pencatatan Bon</h3>

          <label>Nama Karyawan</label>
          <select
            value={bonForm.employeeName}
            onChange={(e) =>
              setBonForm({
                ...bonForm,
                employeeName: e.target.value,
              })
            }
            required
          >
            <option value="">Pilih karyawan</option>

            {employees.map((employee) => (
              <option
                key={employee.name}
                value={employee.name}
              >
                {employee.name}
              </option>
            ))}
          </select>

          <label>Nominal Bon (Rp)</label>
          <input
            type="number"
            min="1"
            value={bonForm.amount}
            onChange={(e) =>
              setBonForm({
                ...bonForm,
                amount: e.target.value,
              })
            }
            placeholder="Contoh: 1000000"
            required
          />

          <label>Rencana Cicilan per Bulan (Rp)</label>
          <input
            type="number"
            min="1"
            value={bonForm.installmentAmount}
            onChange={(e) =>
              setBonForm({
                ...bonForm,
                installmentAmount: e.target.value,
              })
            }
            placeholder="Contoh: 250000"
            required
          />

          <label>Keterangan Bon</label>
          <textarea
            value={bonForm.reason}
            onChange={(e) =>
              setBonForm({
                ...bonForm,
                reason: e.target.value,
              })
            }
            placeholder="Tuliskan keterangan bon..."
            required
          />

          <label>Catatan Tambahan</label>
          <textarea
            value={bonForm.notes}
            onChange={(e) =>
              setBonForm({
                ...bonForm,
                notes: e.target.value,
              })
            }
            placeholder="Opsional"
          />

          <div className="bon-form-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={() => setShowBonForm(false)}
            >
              Batal
            </button>

            <button
              type="submit"
              className="primary-button"
            >
              Simpan Catatan Bon
            </button>
          </div>
        </form>
      )}

      <div className="bon-toolbar">
        <button type="button" className="primary-button" onClick={handleProcessMonthlyBon}>
          Proses Potongan {month}
        </button>
        <span className="bon-reason">Nilai cicilan yang belum diproses sudah diperhitungkan dalam payroll.</span>
      </div>

      {/* FILTER DAN PENCARIAN */}
      <div className="bon-toolbar">
        <input
          value={bonSearch}
          onChange={(e) => setBonSearch(e.target.value)}
          placeholder="Cari nama karyawan atau alasan..."
        />

        <select
          value={bonFilter}
          onChange={(e) => setBonFilter(e.target.value)}
        >
          <option value="Semua">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="paid">Lunas</option>
        </select>
      </div>

      {/* DAFTAR BON */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>NO</th>
              <th>KARYAWAN</th>
              <th>TANGGAL</th>
              <th>NOMINAL</th>
              <th>CICILAN</th>
              <th>SUDAH DIPOTONG</th>
              <th>SISA</th>
              <th>STATUS</th>
              <th>AKSI</th>
            </tr>
          </thead>

          <tbody>
            {filteredBonRecords.map((bon, index) => {
              const remaining =
                bon.amount - bon.paidAmount;

              return (
                <tr key={bon.id}>
                  <td>{index + 1}</td>

                  <td>
                    <strong>{bon.employeeName}</strong>
                    <small className="bon-reason">
                      {bon.reason}
                    </small>
                  </td>

                  <td>
                    {new Date(bon.createdAt).toLocaleDateString("id-ID")}
                  </td>

                  <td>{money(bon.amount)}</td>

                  <td>{money(bon.installmentAmount)}</td>

                  <td>{money(bon.paidAmount)}</td>

                  <td>
                    <strong>{money(remaining)}</strong>
                  </td>

                  <td>
                    <span className={`bon-status ${bon.status}`}>
                      {bon.status === "active" && "Aktif"}
                      {bon.status === "paid" && "Lunas"}
                    </span>
                  </td>

                  <td>
                    <div className="bon-actions">

                      {bon.status === "active" && (
                        <>
                          <button type="button" className="bon-detail" onClick={() => handleEditInstallment(bon)}>
                            Ubah Cicilan
                          </button>
                          <button type="button" className="bon-detail" onClick={() => setSelectedBon(bon)}>
                            Detail
                          </button>
                        </>
                      )}
                      {bon.status === "paid" && (
                        <button type="button" className="bon-detail" onClick={() => setSelectedBon(bon)}>
                          Detail
                        </button>
                      )}
                      <button
                        type="button"
                        className="bon-delete"
                        onClick={() => handleDeleteBon(bon.id)}
                        title="Hapus catatan bon beserta riwayat potongannya"
                      >
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredBonRecords.length === 0 && (
          <div className="empty-state">
            Tidak ada data bon yang sesuai.
          </div>
        )}
      </div>

    </section>
  </section>
)}



{activePage === "Bonus & Penjualan" && (
  <section className="panel full-panel">
    <div className="panel-heading">
      <div><h3>Manajemen Bonus & Penjualan</h3><p>Periode {month} · Terhubung otomatis dengan penggajian</p></div>
      <span className="count-badge">{bonusPeriodRecords.length} Catatan</span>
    </div>
    <div className="bon-summary">
      <div className="bon-card"><span>Total Bonus</span><strong>{money(totalBonusPeriod)}</strong></div>
      <div className="bon-card"><span>Bonus Target</span><strong>{money(bonusPeriodRecords.filter(r=>r.type==="target").reduce((a,r)=>a+r.amount,0))}</strong></div>
      <div className="bon-card"><span>Bonus Menu</span><strong>{money(bonusPeriodRecords.filter(r=>r.type.startsWith("menu-")).reduce((a,r)=>a+r.amount,0))}</strong></div>
      <div className="bon-card"><span>Bonus Reservasi</span><strong>{money(bonusPeriodRecords.filter(r=>r.type==="reservation").reduce((a,r)=>a+r.amount,0))}</strong></div>
    </div>
    {bonusMessage && <div className="import-message">{bonusMessage}</div>}
    <form className={`bon-form ${bonusType === "reservation" ? "bon-form-reservation" : ""}`} onSubmit={handleSaveBonus}>
      <h3>Tambah Catatan Bonus</h3>
      <label>Jenis Bonus</label>
      <select value={bonusType} onChange={(e)=>{setBonusType(e.target.value);setBonusMessage("");}}>
        <option value="target">Bonus Penjualan Memenuhi Target</option>
        <option value="menu">Bonus Pembuatan Menu</option>
        <option value="reservation">Bonus Reservasi</option>
      </select>
      {bonusType==="target" && <>
        <label>Jumlah Produk Terjual</label>
        <input type="number" min="1" step="1" required value={bonusForm.transactionValue} onChange={(e)=>setBonusForm({...bonusForm,transactionValue:e.target.value})} placeholder="Masukkan jumlah produk terjual"/>
        <div className="summary-line"><span>Tarif bonus per produk</span><strong>Rp500</strong></div>
        <div className="summary-line"><span>Total bonus target</span><strong>{money(Math.floor(Number(bonusForm.transactionValue||0))*500)}</strong></div>
        <div className="summary-line"><span>Karyawan aktif penerima</span><strong>{employees.filter(e=>e.status!=="nonaktif" && e.name.trim().toUpperCase()!=="MBAH NO").length} orang</strong></div>
        <div className="summary-total"><span>Estimasi bonus per karyawan</span><strong>{money(employees.filter(e=>e.status!=="nonaktif" && e.name.trim().toUpperCase()!=="MBAH NO").length?Math.floor(Math.floor(Number(bonusForm.transactionValue||0))*500/employees.filter(e=>e.status!=="nonaktif" && e.name.trim().toUpperCase()!=="MBAH NO").length):0)}</strong></div>
        <p className="bon-reason">Bonus target dihitung dari jumlah produk terjual × Rp500, lalu dibagi rata kepada 12 karyawan aktif kecuali Mbah No. Sisa pembulatan dibagikan agar total pembagian tepat.</p>
      </>}
      {bonusType==="menu" && <>
        <div className="summary-line"><span>Head Chef · per menu makanan</span><strong>Rp7.000</strong></div>
        <label>Jumlah Menu Makanan Baru</label>
        <input type="number" min="0" step="1" value={bonusForm.foodCount} onChange={(e)=>setBonusForm({...bonusForm,foodCount:e.target.value})} placeholder="Jumlah menu makanan"/>
        <div className="summary-line"><span>Senior Barista · per menu minuman</span><strong>Rp5.000</strong></div>
        <label>Jumlah Menu Minuman Baru</label>
        <input type="number" min="0" step="1" value={bonusForm.drinkCount} onChange={(e)=>setBonusForm({...bonusForm,drinkCount:e.target.value})} placeholder="Jumlah menu minuman"/>
        <div className="summary-line"><span>Estimasi bonus Head Chef</span><strong>{money((Number(bonusForm.foodCount)||0)*7000)}</strong></div>
        <div className="summary-line"><span>Estimasi bonus Senior Barista</span><strong>{money((Number(bonusForm.drinkCount)||0)*5000)}</strong></div>
        <p className="bon-reason">Bonus menu hanya diberikan kepada HEAD CHEF untuk menu makanan dan SENIOR BARISTA untuk menu minuman. Jumlah dan perhitungan keduanya dicatat terpisah.</p>
      </>}
      {bonusType==="reservation" && <>
        <label>Tanggal Reservasi</label>
        <input type="date" required value={reservationDate} onChange={(e)=>setReservationDate(e.target.value)}/>
        <label>Nama Reservasi / Pelanggan</label>
        <input value={bonusForm.reservationName} onChange={(e)=>setBonusForm({...bonusForm,reservationName:e.target.value})} placeholder="Nama pelanggan atau rombongan"/>
        <label>Nilai Transaksi (Rp)</label>
        <input type="number" min="1" required value={bonusForm.transactionValue} onChange={(e)=>setBonusForm({...bonusForm,transactionValue:e.target.value})} placeholder="Contoh: 5000000"/>
        <div className="summary-line"><span>Bonus reservasi (5%) — estimasi</span><strong>{money(Math.round(Number(bonusForm.transactionValue || 0) * 0.05))}</strong></div>
        <p className="bon-reason">Simpan setiap reservasi ke daftar di sebelah kanan. Bonus belum dibagikan dan belum masuk payroll sampai diproses saat penggajian.</p>
      </>}
      <div className="bon-form-actions">
        <button type="button" className="cancel-button" onClick={resetBonusForm}>Reset</button>
        <button type="submit" className="primary-button">{bonusType === "reservation" ? "Tambah ke Daftar Reservasi" : "Simpan Bonus ke Payroll"}</button>
      </div>
    </form>
    {bonusType === "reservation" && (
      <section className="reservation-ledger panel">
        <div className="panel-heading">
          <div><h3>Daftar Reservasi · {month}</h3><p>Reservasi dikumpulkan terlebih dahulu, belum masuk payroll.</p></div>
          <span className="count-badge">{reservationEntriesForPeriod.length} Reservasi</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>TANGGAL</th><th>NAMA RESERVASI</th><th>NILAI TRANSAKSI</th><th>BONUS 5%</th><th>STATUS</th><th>AKSI</th></tr></thead>
            <tbody>
              {reservationEntriesForPeriod.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.date}</td><td><strong>{entry.reservationName}</strong></td>
                  <td>{money(entry.transactionValue)}</td><td>{money(entry.bonusAmount ?? Math.round(entry.transactionValue * 0.05))}</td>
                  <td><span className={`bon-status ${entry.processedAt ? "paid" : "pending"}`}>{entry.processedAt ? "Masuk Payroll" : "Menunggu"}</span></td>
                  <td>{!entry.processedAt && <button type="button" className="bon-delete" onClick={() => handleDeleteReservationEntry(entry.id)}>Hapus</button>}</td>
                </tr>
              ))}
              {reservationEntriesForPeriod.length === 0 && <tr><td colSpan="6" className="empty-state">Belum ada reservasi untuk periode ini.</td></tr>}
            </tbody>
            <tfoot><tr>
              <th colSpan="2">TOTAL PERIODE</th>
              <th>{money(reservationEntriesForPeriod.reduce((sum, entry) => sum + Number(entry.transactionValue || 0), 0))}</th>
              <th>{money(reservationEntriesForPeriod.reduce((sum, entry) => sum + Math.round(Number(entry.transactionValue || 0) * 0.05), 0))}</th>
              <th colSpan="2"></th>
            </tr></tfoot>
          </table>
        </div>
        <div className="reservation-process-summary">
          <div><span>Total transaksi menunggu</span><strong>{money(pendingReservationTransactionTotal)}</strong></div>
          <div><span>Total bonus 5% menunggu</span><strong>{money(pendingReservationBonusTotal)}</strong></div>
          <div><span>Penerima payroll</span><strong>{reservationEligibleEmployees.length} karyawan aktif</strong></div>
          <button type="button" className="primary-button" disabled={pendingReservationEntries.length === 0} onClick={handleProcessReservationPayroll}>Proses & Bagi ke Payroll</button>
        </div>
      </section>
    )}
    <div className="panel-heading" style={{marginTop:28}}>
      <div><h3>Riwayat Bonus Periode {month}</h3><p>Rincian bonus masing-masing karyawan</p></div>
      <button type="button" className="primary-button" onClick={()=>{
        const rows=bonusPeriodRecords.map((r,i)=>({"NO":i+1,"KARYAWAN":r.employeeName,"JENIS BONUS":r.typeLabel,"KETERANGAN":r.description,"PERIODE":r.period,"NOMINAL":r.amount}));
        const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Bonus");
        XLSX.writeFile(wb,`Bonus_${month.replaceAll(" ","_")}.xlsx`);
      }}>Export Excel</button>
    </div>
    <div className="table-wrap">
      <table><thead><tr><th>NO</th><th>KARYAWAN</th><th>JENIS BONUS</th><th>KETERANGAN</th><th>NOMINAL</th><th>AKSI</th></tr></thead>
      <tbody>{bonusPeriodRecords.map((r,i)=><tr key={r.id}>
        <td>{i+1}</td><td><strong>{r.employeeName}</strong></td><td>{r.typeLabel}</td>
        <td>{r.description}{(r.type==="reservation"||r.type==="target")&&<small className="bon-reason">Total transaksi {money(r.transactionValue)} · {r.percentage || (r.type==="target"?3:5)}%</small>}</td>
        <td><strong>{money(r.amount)}</strong></td><td><button type="button" className="bon-delete" onClick={()=>handleDeleteBonus(r.id)}>Hapus</button></td>
      </tr>)}</tbody></table>
      {bonusPeriodRecords.length===0&&<div className="empty-state">Belum ada catatan bonus untuk periode ini.</div>}
    </div>
    <p className="payroll-note">Bonus periode ini otomatis menambah penghasilan karyawan pada menu Penggajian. Pembagian reservasi menggunakan daftar karyawan aktif saat transaksi dicatat.</p>
  </section>
)}

{activePage === "Pembayaran" && (
  <section className="panel full-panel">
    <div className="panel-heading">
      <div>
        <h3>Slip Gaji Karyawan</h3>
        <p>Daftar rincian gaji bersih karyawan untuk periode {month}.</p>
      </div>
      <span className="count-badge">{payrollData.length} Karyawan</span>
    </div>
    <div className="excel-import-toolbar">
      <div><strong>Rincian slip gaji</strong>
        <p>Semua nominal dihitung otomatis sesuai periode. Tombol Kirim WA membuka WhatsApp dengan rincian slip siap dikirim; isi nomor WhatsApp pada Data Karyawan.</p></div>
      <button type="button" className="primary-button" onClick={handleExportPayslips}>
        ⇩ Export Slip Gaji Excel
      </button>
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>NO</th><th>NAMA KARYAWAN</th><th>POSISI</th><th>GAJI POKOK</th>
          <th>UANG LEMBUR</th><th>BON</th><th>BONUS TARGET</th><th>BONUS MENU</th><th>BONUS RESERVASI</th><th>GAJI BERSIH</th><th>SLIP</th>
        </tr></thead>
        <tbody>
          {payrollData.map((employee, index) => {
            const employeeBonusRecords = bonusPeriodRecords.filter((record) => record.employeeName === employee.name);
            const isMenuBonusRecipient = ["HEAD CHEF", "SENIOR BARISTA"].includes(String(employee.position || "").trim().toUpperCase());
            const bonusTarget = employeeBonusRecords.filter((record) => record.type === "target").reduce((sum, record) => sum + Number(record.amount || 0), 0);
            const bonusMenu = employeeBonusRecords.filter((record) => record.type === "menu-food" || record.type === "menu-drink")
              .reduce((sum, record) => sum + Number(record.amount || 0), 0);
            const bonusReservation = employeeBonusRecords.filter((record) => record.type === "reservation")
              .reduce((sum, record) => sum + Number(record.amount || 0), 0);
            return <tr key={employee.id || employee.name}>
              <td>{index + 1}</td><td><strong>{employee.name}</strong></td>
              <td>{employee.position}</td><td>{money(employee.salary)}</td>
              <td>{money(employee.overtimePay)}</td><td>{money(Number(employee.bonDeduction || 0))}</td>
              <td>{money(bonusTarget)}</td><td>{isMenuBonusRecipient ? money(bonusMenu) : "—"}</td>
              <td>{money(bonusReservation)}</td><td><strong>{money(employee.totalPayroll)}</strong></td>
              <td>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="primary-button"
                    onClick={() => handlePrintPayslip(employee)}>Cetak</button>
                  <button type="button" className="secondary-button"
                    onClick={() => handleWhatsAppPayslip(employee)}>Kirim WA</button>
                </div>
              </td>
            </tr>;
          })}
        </tbody>
        <tfoot><tr>
          <th colSpan="3">TOTAL</th><th>{money(totals.salary)}</th><th>{money(totals.overtime)}</th>
          <th>{money(payrollData.reduce((sum, employee) => sum + Number(employee.bonDeduction || 0), 0))}</th>
          <th>{money(bonusPeriodRecords.filter((record) => record.type === "target").reduce((sum, record) => sum + Number(record.amount || 0), 0))}</th>
          <th>{money(bonusPeriodRecords.filter((record) => record.type === "menu-food" || record.type === "menu-drink").reduce((sum, record) => sum + Number(record.amount || 0), 0))}</th>
          <th>{money(bonusPeriodRecords.filter((record) => record.type === "reservation").reduce((sum, record) => sum + Number(record.amount || 0), 0))}</th>
          <th>{money(payrollData.reduce((sum, employee) => sum + Number(employee.totalPayroll || 0), 0))}</th><th></th>
        </tr></tfoot>
      </table>
    </div>
    <p className="payroll-note">Bonus ditampilkan terpisah menjadi bonus target, bonus menu (khusus Head Chef dan Senior Barista), serta bonus reservasi. Gaji bersih mengikuti hasil perhitungan payroll.</p>
  </section>
)}


{activePage === "Laporan Gaji" && (
  <section className="panel full-panel salary-report">
    <div className="salary-report-heading">
      <div className="salary-report-title">
        <span className="salary-report-kicker">PAYROLL ANALYTICS</span>
        <h3>Laporan Gaji Karyawan</h3>
        <p>Rekapitulasi penghasilan dan potongan seluruh karyawan · Periode {displayedSalaryReportPeriod}.</p>
      </div>
      <span className="salary-report-count">{displayedSalaryReportRows.length} Karyawan</span>
    </div>

    <div className="salary-archive-panel">
      <div className="salary-archive-copy">
        <strong>Arsip Laporan Bulanan</strong>
        <span>{salaryReportArchives.length} periode tersimpan. Arsip merupakan snapshot dan tidak berubah saat data payroll bulan lain diperbarui.</span>
      </div>
      <div className="salary-archive-actions">
        <select aria-label="Pilih arsip laporan gaji" value={selectedSalaryArchive} onChange={(event) => { setSelectedSalaryArchive(event.target.value); setSalaryArchiveMessage(""); }}>
          <option value="">Laporan berjalan · {month}</option>
          {salaryReportArchives.map((archive) => <option key={archive.period} value={archive.period}>{archive.period}</option>)}
        </select>
        <button type="button" className="primary-button" onClick={handleSaveSalaryArchive}>Simpan Arsip Bulan Ini</button>
        {activeSalaryArchive && <button type="button" className="secondary-button" onClick={handleDeleteSalaryArchive}>Hapus Arsip</button>}
      </div>
      {salaryArchiveMessage && <p className="salary-archive-message">{salaryArchiveMessage}</p>}
      {activeSalaryArchive && <small className="salary-archive-stamp">Disimpan: {new Date(activeSalaryArchive.savedAt).toLocaleString("id-ID")}</small>}
    </div>

    <div className="salary-report-toolbar">
      <div>
        <strong>Ringkasan penggajian periode {displayedSalaryReportPeriod}</strong>
        <p>Angka dihitung otomatis dari Penggajian, Bon Karyawan, dan Bonus & Penjualan.</p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="secondary-button" onClick={handlePrintSalaryReport}>Cetak Laporan</button>
        <button type="button" className="primary-button" onClick={handleExportSalaryReport}>⇩ Export Excel</button>
      </div>
    </div>

    <div className="salary-report-metrics">
      <div className="salary-metric"><span className="salary-metric-icon">Rp</span><span className="salary-metric-label">Total Gaji Pokok</span><strong>{money(displayedSalaryReportTotals.salary)}</strong></div>
      <div className="salary-metric"><span className="salary-metric-icon">↗</span><span className="salary-metric-label">Total Uang Lembur</span><strong>{money(displayedSalaryReportTotals.overtime)}</strong></div>
      <div className="salary-metric"><span className="salary-metric-icon">✦</span><span className="salary-metric-label">Total Bonus</span><strong>{money(displayedSalaryReportTotals.bonuses)}</strong></div>
      <div className="salary-metric"><span className="salary-metric-icon">−</span><span className="salary-metric-label">Total Potongan Bon</span><strong>{money(displayedSalaryReportTotals.bon)}</strong></div>
      <div className="salary-metric salary-metric-muted"><span className="salary-metric-icon">▤</span><span className="salary-metric-label">Penghasilan Kotor</span><strong>{money(displayedSalaryReportTotals.gross)}</strong></div>
      <div className="salary-metric salary-metric-primary"><span className="salary-metric-icon">✓</span><span className="salary-metric-label">Total Gaji Bersih</span><strong>{money(displayedSalaryReportTotals.net)}</strong></div>
    </div>

    <div className="salary-report-table-heading">
      <div>
        <h4>Rincian per Karyawan</h4>
        <p>Rincian komponen penghasilan dan potongan pada periode terpilih.</p>
      </div>
      <div className="salary-report-search">
        <span>⌕</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari nama atau posisi..." />
      </div>
    </div>

    <div className="table-wrap salary-report-table">
      <table>
        <thead><tr>
          <th>NO</th><th>NAMA KARYAWAN</th><th>POSISI</th><th>GAJI POKOK</th>
          <th>UANG LEMBUR</th><th>BON</th><th>BONUS TARGET</th><th>BONUS MENU</th>
          <th>BONUS RESERVASI</th><th>PENGHASILAN KOTOR</th><th>GAJI BERSIH</th>
        </tr></thead>
        <tbody>
          {filteredSalaryReportRows.map((row) => (
            <tr key={row.name}>
              <td>{row.no}</td><td><strong>{row.name}</strong></td><td>{row.position}</td>
              <td>{money(row.salary)}</td><td>{money(row.overtimePay)}</td><td>{money(row.bonDeduction)}</td>
              <td>{money(row.bonusTarget)}</td>
              <td>{["HEAD CHEF", "SENIOR BARISTA"].includes(String(row.position || "").trim().toUpperCase()) ? money(row.bonusMenu) : "—"}</td>
              <td>{money(row.bonusReservation)}</td><td>{money(row.gross)}</td><td><strong>{money(row.net)}</strong></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <th colSpan="3">TOTAL</th><th>{money(displayedSalaryReportTotals.salary)}</th>
          <th>{money(displayedSalaryReportTotals.overtime)}</th><th>{money(displayedSalaryReportTotals.bon)}</th>
          <th>{money(displayedSalaryReportTotals.bonusTarget)}</th><th>{money(displayedSalaryReportTotals.bonusMenu)}</th>
          <th>{money(displayedSalaryReportTotals.bonusReservation)}</th><th>{money(displayedSalaryReportTotals.gross)}</th>
          <th>{money(displayedSalaryReportTotals.net)}</th>
        </tr></tfoot>
      </table>
      {filteredSalaryReportRows.length === 0 && <div className="empty-state">Data karyawan tidak ditemukan.</div>}
    </div>
    <div className="salary-report-footnote"><strong>Catatan perhitungan</strong><span>Penghasilan kotor = gaji pokok + uang lembur + seluruh bonus. Gaji bersih = penghasilan kotor − potongan bon. Bonus menu hanya dihitung untuk Head Chef dan Senior Barista.</span></div>
  </section>
)}

{activePage === "Pengaturan" && (
  <section className="settings-page">
    <div className="settings-intro">
      <div><span className="eyebrow">KONFIGURASI APLIKASI</span><h2>Pengaturan Sistem</h2><p>Atur identitas usaha dan parameter dasar pengelolaan penggajian.</p></div>
      <span className="settings-mark">⚙</span>
    </div>
    <form className="settings-form" onSubmit={saveAppSettings}>
      <section className="panel settings-card">
        <div className="panel-heading"><div><h3>Identitas Usaha</h3><p>Informasi identitas aplikasi dan dokumen.</p></div></div>
        <div className="settings-grid">
          <label className="settings-field settings-field-wide">Nama Usaha
            <input value={appSettings.businessName} onChange={(e) => setAppSettings({ ...appSettings, businessName: e.target.value })} />
          </label>
          <label className="settings-field settings-field-wide">Alamat Usaha
            <textarea rows="3" value={appSettings.businessAddress} onChange={(e) => setAppSettings({ ...appSettings, businessAddress: e.target.value })} placeholder="Alamat lengkap usaha" />
          </label>
          <label className="settings-field">Nomor Telepon Usaha
            <input type="tel" value={appSettings.businessPhone} onChange={(e) => setAppSettings({ ...appSettings, businessPhone: e.target.value })} placeholder="08xxxxxxxxxx" />
          </label>
          <label className="settings-field">WhatsApp Admin
            <input type="tel" value={appSettings.adminWhatsapp} onChange={(e) => setAppSettings({ ...appSettings, adminWhatsapp: e.target.value })} placeholder="08xxxxxxxxxx" />
          </label>
        </div>
      </section>
      <section className="panel settings-card">
        <div className="panel-heading"><div><h3>Pengaturan Penggajian</h3><p>Parameter dasar administrasi penggajian.</p></div></div>
        <div className="settings-grid">
          <label className="settings-field">Jadwal Pembayaran Gaji
            <select value={appSettings.payrollDate} onChange={(e) => setAppSettings({ ...appSettings, payrollDate: e.target.value })}>
              <option value="awal bulan">Awal bulan</option><option value="pertengahan bulan">Pertengahan bulan</option><option value="akhir bulan">Akhir bulan</option><option value="sesuai kebijakan">Sesuai kebijakan</option>
            </select>
          </label>
          <label className="settings-field">Jam Kerja Normal per Hari
            <input type="number" min="1" max="24" value={appSettings.normalWorkHours} onChange={(e) => setAppSettings({ ...appSettings, normalWorkHours: e.target.value })} />
          </label>
          <label className="settings-field">Pembagi Perhitungan Lembur
            <input type="number" min="1" value={appSettings.overtimeDivisor} onChange={(e) => setAppSettings({ ...appSettings, overtimeDivisor: e.target.value })} />
          </label>
        </div>
        <p className="settings-note">Pengaturan parameter disimpan sebagai konfigurasi. Rumus payroll yang berjalan tidak diubah otomatis agar hasil penggajian sebelumnya tetap konsisten.</p>
      </section>
      <div className="settings-actions">
        {settingsMessage && <span className="settings-success">✓ {settingsMessage}</span>}
        <button type="submit" className="primary-button">Simpan Pengaturan</button>
      </div>
    </form>
  </section>
)}

{activePage !== "Dashboard" &&
 activePage !== "Data Karyawan" &&
 activePage !== "Penggajian" &&
 activePage !== "Import Absensi" &&
 activePage !== "Bon Karyawan" &&
 activePage !== "Bonus & Penjualan" &&
 activePage !== "Pembayaran" &&
 activePage !== "Laporan Gaji" &&
 activePage !== "Pengaturan" && (
  <section className="panel coming-panel">
    <div className="coming-icon">◈</div>
    <h2>{activePage}</h2>
    <p>Modul ini akan dibangun pada tahap selanjutnya.</p>
    <button
      className="primary-button"
      onClick={() => setActivePage("Dashboard")}
    >
      Kembali ke Dashboard
    </button>
  </section>
)}


{showAddEmployee && (
  <div className="modal-overlay">
    <div className="employee-modal">
      <div className="modal-heading">
        <div>
          <span className="eyebrow">MANAJEMEN KARYAWAN</span>
          <h2>Tambah Karyawan</h2>
          <p>Masukkan informasi karyawan baru.</p>
        </div>

        <button
          className="modal-close"
          type="button"
          onClick={() => setShowAddEmployee(false)}
        >
          ×
        </button>
      </div>

      <form onSubmit={handleAddEmployee}>
        <label>Nama Karyawan</label>
        <input
          value={newEmployee.name}
          onChange={(e) =>
            setNewEmployee({
              ...newEmployee,
              name: e.target.value,
            })
          }
          placeholder="Contoh: BUDI SANTOSO"
          required
        />

        <label>Posisi / Jabatan</label>
        <input
          value={newEmployee.position}
          onChange={(e) =>
            setNewEmployee({
              ...newEmployee,
              position: e.target.value,
            })
          }
          placeholder="Contoh: COOK"
          required
        />

        <label>Nomor WhatsApp</label>
        <input
          type="tel"
          value={newEmployee.phone}
          onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
          placeholder="Contoh: 081234567890"
        />

        <label>Gaji Pokok (Rp)</label>
        <input
          type="number"
          min="1"
          value={newEmployee.salary}
          onChange={(e) =>
            setNewEmployee({
              ...newEmployee,
              salary: e.target.value,
            })
          }
          placeholder="Contoh: 2000000"
          required
        />

        {formError && (
          <div className="form-error">{formError}</div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="cancel-button"
            onClick={() => setShowAddEmployee(false)}
          >
            Batal
          </button>

          <button type="submit" className="primary-button">
            Simpan Karyawan
          </button>
        </div>
      </form>
    </div>
  </div>
)}

{editingEmployee && (
  <div className="modal-overlay">
    <div className="employee-modal">
      <div className="modal-heading">
        <div>
          <span className="eyebrow">MANAJEMEN KARYAWAN</span>
          <h2>Edit Karyawan</h2>
          <p>Perbarui informasi karyawan.</p>
        </div>

        <button
          className="modal-close"
          type="button"
          onClick={() => setEditingEmployee(null)}
        >
          ×
        </button>
      </div>

      <form onSubmit={handleEditEmployee}>
        <label>Nama Karyawan</label>
        <input
          value={editingEmployee.name}
          onChange={(e) =>
            setEditingEmployee({
              ...editingEmployee,
              name: e.target.value,
            })
          }
          required
        />

        <label>Posisi / Jabatan</label>
        <input
          value={editingEmployee.position}
          onChange={(e) =>
            setEditingEmployee({
              ...editingEmployee,
              position: e.target.value,
            })
          }
          required
        />

        <label>Nomor WhatsApp</label>
        <input
          type="tel"
          value={editingEmployee.phone || ""}
          onChange={(e) => setEditingEmployee({ ...editingEmployee, phone: e.target.value })}
          placeholder="Contoh: 081234567890"
        />

        <label>Gaji Pokok (Rp)</label>
        <input
          type="number"
          min="1"
          value={editingEmployee.salary}
          onChange={(e) =>
            setEditingEmployee({
              ...editingEmployee,
              salary: e.target.value,
            })
          }
          required
        />

        <div className="modal-actions">
          <button
            type="button"
            className="cancel-button"
            onClick={() => setEditingEmployee(null)}
          >
            Batal
          </button>

          <button type="submit" className="primary-button">
            Simpan Perubahan
          </button>
        </div>
      </form>
    </div>
  </div>
)}


{selectedBon && (
  <div className="modal-overlay">
    <div className="employee-modal bon-modal">

      <div className="modal-heading">
        <div>
          <span className="eyebrow">BON KARYAWAN</span>
          <h2>{selectedBon.employeeName}</h2>
          <p>Detail bon dan riwayat potongan gaji</p>
        </div>

        <button
          type="button"
          className="modal-close"
          onClick={() => setSelectedBon(null)}
        >
          ×
        </button>
      </div>

      <div className="bon-detail-grid">
        <div>
          <span>Nominal Bon</span>
          <strong>{money(selectedBon.amount)}</strong>
        </div>

        <div>
          <span>Sudah Dibayar</span>
          <strong>{money(selectedBon.paidAmount)}</strong>
        </div>

        <div>
          <span>Sisa Bon</span>
          <strong>
            {money(selectedBon.amount - selectedBon.paidAmount)}
          </strong>
        </div>

        <div>
          <span>Cicilan Rencana</span>
          <strong>{money(selectedBon.installmentAmount)}</strong>
        </div>
      </div>

      <p className="bon-reason">Cicilan dipotong otomatis sebesar {money(selectedBon.installmentAmount)} per bulan selama bon masih aktif. Perubahan cicilan dilakukan dari daftar bon.</p>

      <h3>Riwayat Cicilan</h3>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>TANGGAL</th>
              <th>PERIODE</th>
              <th>METODE</th>
              <th>NOMINAL</th>
            </tr>
          </thead>

          <tbody>
            {selectedBon.payments.map((payment) => (
              <tr key={payment.id}>
                <td>
                  {new Date(payment.paymentDate).toLocaleDateString("id-ID")}
                </td>
                <td>{payment.payrollPeriod}</td>
                <td>{payment.paymentMethod}</td>
                <td>{money(payment.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {selectedBon.payments.length === 0 && (
          <div className="empty-state">
            Belum ada potongan gaji.
          </div>
        )}
      </div>

    </div>
  </div>
)}

          <footer className="footer">
            <span>© 2026 SISI DANAU PAYROLL</span>
            <span>Payroll Management System <b>•</b> Versi 1.0</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, note }) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span>{label}</span><div className="stat-icon">{icon}</div></div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </div>
  );
}

export default App;
