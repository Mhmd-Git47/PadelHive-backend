const locationService = require("../services/location.service");
const { AppError } = require("../utils/errors");

// Create location
const createLocation = async (req, res, next) => {
  try {
    const { companyId, ...locationData } = req.body;
    if (!companyId)
      throw new AppError("Cannot assign location without company", 403);

    const location = await locationService.createLocation(
      companyId,
      locationData
    );
    res.status(201).json({ location });
  } catch (err) {
    next(err);
  }
};

// Get all locations
const getLocations = async (req, res, next) => {
  try {
    const companyId =
      req.user.role === "company_admin" ? req.user.company_id : null;
    const locations = await locationService.getLocations(companyId);
    res.json(locations);
  } catch (err) {
    next(err);
  }
};

// Get location by ID
const getLocationById = async (req, res, next) => {
  try {
    const location = await locationService.getLocationById(req.params.id);

    res.json(location);
  } catch (err) {
    next(err);
  }
};

// Update location
const updateLocation = async (req, res, next) => {
  try {
    const location = await locationService.getLocationById(req.params.id);

    // Authorization
    if (
      req.user.role === "company_admin" &&
      location.company_id !== req.user.company_id
    )
      throw new AppError("Forbidden", 403);

    if (
      req.user.role === "location_admin" &&
      location.id !== req.user.location_id
    )
      throw new AppError("Forbidden", 403);

    const updated = await locationService.updateLocation(
      req.params.id,
      req.body
    );
    res.json({ location: updated });
  } catch (err) {
    next(err);
  }
};

// Delete location
const deleteLocation = async (req, res, next) => {
  try {
    const location = await locationService.getLocationById(req.params.id);

    if (
      req.user.role === "company_admin" &&
      location.company_id !== req.user.company_id
    )
      throw new AppError("Forbidden", 403);

    if (req.user.role === "location_admin")
      throw new AppError("Forbidden", 403);

    await locationService.deleteLocation(req.params.id);
    res.json({ message: "Location deleted successfully" });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createLocation,
  getLocations,
  getLocationById,
  updateLocation,
  deleteLocation,
};
