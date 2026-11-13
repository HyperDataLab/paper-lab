from helpers import abstract_of, map_members, stability


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
