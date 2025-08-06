const companyService = require("../services/company.service");

exports.getCompanyById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await companyService.getCompanyById(id);
    if (!result) {
      return res.status(404).json({ error: "Company not found" });
    }
    return res.json(result);
  } catch (err) {
    console.error("Error fetching company data: ", err);
    return res.status(500).json({ error: "Server error" });
  }
};

exports.createCompany = async (req, res) => {
  const adminId = req.user.id;
  const companyData = req.body;

  try {
    const newCompany = await companyService.createCompany(adminId, companyData);
    res.status(201).json(newCompany);
  } catch (err) {
    console.error("Error creating company:", err);
    res.status(500).json({ error: "Failed to create company" });
  }
};

exports.updateCompany = async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  try {
    const updatedCompany = await companyService.updateCompany(id, updatedData);
    res.json(updatedCompany);
  } catch (err) {
    console.error("Error updating company: ", err);
    res.status(500).json({ error: "Failed to update company" });
  }
};
