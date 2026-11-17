from math import isclose

from helpers import abstract_of, map_members, percentile, stability, subfield_id, top_subfields, topic_fit


def test_subfield_id_strips_the_openalex_prefix():
    assert subfield_id({"id": "https://openalex.org/subfields/1702"}) == "subfields/1702"
    assert subfield_id({"id": "https://openalex.org/fields/17"}) is None
    assert subfield_id({}) is None
    assert subfield_id(None) is None


def test_top_subfields_counts_by_name_and_adds_known_ids():
    members = [{"oa_subfield": "AI", "oa_subfield_id": "subfields/1702"}, {"oa_subfield": "AI"},
               {"oa_subfield": "Old"}, {"oa_subfield": None}]
    assert top_subfields(members) == [{"name": "AI", "id": "subfields/1702", "count": 2},
                                      {"name": "Old", "count": 1}]


def test_abstract_reconstruction():
    assert abstract_of({"world": [1], "hello": [0, 2]}) == "hello world hello"
    assert abstract_of(None) == ""


def test_stability_matches_by_overlap():
    assert stability([0, 0, 1, 1], [7, 7, 8, 7]) == 0.75
    assert stability([], []) == 0


def test_member_mapping_preserves_duplicates():
    result = map_members([{"memberId": "a", "openalexId": "https://openalex.org/W1"},
                          {"memberId": "b", "openalexId": "W1"}])
    assert [m["openalexId"] for m in result] == ["W1", "W1"]


def test_topic_fit_clear_clusters():
    result = topic_fit([[1, 0], [1, 0], [0, 1], [0, 1]], [0, 0, 1, 1])
    assert all(not member["weak"] for member in result)
    assert [member["nearest"] for member in result] == [0, 0, 1, 1]
    assert all(isclose(member["fit"], 1) and isclose(member["margin"], 1)
               for member in result)


def test_topic_fit_closer_to_other_topic_takes_precedence():
    result = topic_fit([[1, 0], [1, 0], [0, 1], [0, 1], [0, 1]], [0, 0, 0, 1, 1])
    assert result[2]["nearest"] == 1
    assert result[2]["margin"] < 0
    assert result[2]["reason"] == "closer-to-other-topic"


def test_topic_fit_percentile_and_single_topic():
    result = topic_fit([[1, 0, 0], [1, 0, 0], [0, 1, 0]], [4, 4, 4])
    assert [member["reason"] for member in result] == [None, None, "low-fit"]
    assert all(member["margin"] is None and member["nearest"] == 4 for member in result)
    assert isclose(percentile([0, 10], 0.1), 1)


def test_topic_fit_returns_plain_python_types_for_int_subclasses():
    class NpInt(int):
        def __ne__(self, other):
            return ("numpy-bool", int(self) != other)

    result = topic_fit([[1, 0], [0, 1]], [NpInt(0), NpInt(1)])
    assert all(type(member["weak"]) is bool and type(member["nearest"]) is int for member in result)


def test_topic_fit_unassigned_and_zero_vector():
    result = topic_fit([[1, 0], [0, 0], [0, 1]], [0, 0, -1])
    assert result[1]["fit"] == 0
    assert result[1]["reason"] == "low-fit"
    assert result[2] == {"fit": None, "nearest": None, "margin": None, "weak": True, "reason": "unassigned"}
    assert topic_fit([], []) == []
