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

exports.getPublicCompanyInfo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Company ID is required" });
    }

    const company = await companyService.getCompanyById(id);

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    // Only return public-safe fields
    const publicData = {
      id: company.id,
      clubName: company.club_name,
      ownerName: company.owner_name,
      country: company.country,
      city: company.city,
      // address: company.address,
      // latitude: company.latitude,
      // longitude: company.longitude,
      courtsNumber: company.courts_number,
      // phoneNumber: company.phone_number, 
    };

    res.json(publicData);
  } catch (err) {
    console.error("Error fetching public company info:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};